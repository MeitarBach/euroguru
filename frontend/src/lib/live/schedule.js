/**
 * The season's fixture list, read straight from Euroleague.
 *
 * The backend stores the schedule too, but without tip-off times, and a live view is
 * mostly about times. This feed is public, CORS-open, about 9 KB gzipped, and the
 * browser caches it for two hours on its own.
 */

const SCHEDULE_URL = 'https://api-live.euroleague.net/v1/schedules';

// Euroleague publishes every tip-off in Central European time, wherever the game is:
// Dubai's 20:00 local start is listed as 18:00.
const FIXTURE_TIME_ZONE = 'Europe/Paris';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const HOUR = 60 * 60 * 1000;

/** Minutes a time zone is ahead of UTC at a given instant. */
function offsetMinutes(utcMs, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (type) => Number(parts.find(p => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return (asUtc - utcMs) / 60000;
}

/**
 * A wall-clock time in Paris as a real instant. Two passes, because the offset that
 * applies depends on the instant being solved for - which only matters on the two
 * nights a year the clocks change, and is cheap to get right.
 */
export function parisToUtc(year, month, day, hour, minute) {
    const naive = Date.UTC(year, month, day, hour, minute);
    let utc = naive - offsetMinutes(naive, FIXTURE_TIME_ZONE) * 60000;
    const settled = naive - offsetMinutes(utc, FIXTURE_TIME_ZONE) * 60000;
    if (settled !== utc) utc = settled;
    return utc;
}

function tipoffOf(dateText, timeText) {
    const date = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(String(dateText ?? '').trim());
    const time = /^(\d{1,2}):(\d{2})/.exec(String(timeText ?? '').trim());
    if (!date || !time || !(date[1] in MONTHS)) return null;
    return parisToUtc(Number(date[3]), MONTHS[date[1]], Number(date[2]), Number(time[1]), Number(time[2]));
}

const schedules = new Map();

/**
 * Every fixture of a season: { code, round, tipoff (ms), homeCode, awayCode, homeName,
 * awayName, played }. Memoised per season for the life of the page.
 */
export function loadSchedule(seasonCode) {
    if (!schedules.has(seasonCode)) {
        const request = fetch(`${SCHEDULE_URL}?seasonCode=${seasonCode}`)
            .then((res) => {
                if (!res.ok) throw new Error(`Schedule: HTTP ${res.status}`);
                return res.text();
            })
            .then((text) => {
                const xml = new DOMParser().parseFromString(text, 'application/xml');
                const read = (item, tag) => item.querySelector(tag)?.textContent?.trim() ?? '';
                return [...xml.querySelectorAll('item')]
                    .map(item => ({
                        code: Number(read(item, 'game')),
                        round: Number(read(item, 'gameday')),
                        tipoff: tipoffOf(read(item, 'date'), read(item, 'startime')),
                        homeCode: read(item, 'homecode'),
                        awayCode: read(item, 'awaycode'),
                        homeName: read(item, 'hometeam'),
                        awayName: read(item, 'awayteam'),
                        played: read(item, 'played').toLowerCase() === 'true',
                    }))
                    .filter(g => Number.isFinite(g.code) && g.code > 0 && g.tipoff !== null);
            })
            .catch((error) => {
                // Forget the failure so the next call retries instead of replaying it.
                schedules.delete(seasonCode);
                throw error;
            });
        schedules.set(seasonCode, request);
    }
    return schedules.get(seasonCode);
}

// How long after tip-off a game counts as possibly still running, for choosing the
// round before any live data has been read. Generous: overtime and long reviews happen.
const LIVE_SPAN = 2.75 * HOUR;

/**
 * Which round the page is about.
 *
 * A round can span two days (Thursday and Friday of a double week), so this picks a
 * round rather than a date: the round of a game that may be live; else the round of a
 * game starting within 12 hours; else the round of a game that started in the last 18
 * hours, so the morning after still shows last night's results; else the next round.
 */
export function currentRound(games, now) {
    if (!games.length) return null;
    const started = games.filter(g => g.tipoff <= now).sort((a, b) => b.tipoff - a.tipoff);
    const upcoming = games.filter(g => g.tipoff > now).sort((a, b) => a.tipoff - b.tipoff);

    const live = started.find(g => now - g.tipoff < LIVE_SPAN);
    if (live) return live.round;
    if (upcoming[0] && upcoming[0].tipoff - now < 12 * HOUR) return upcoming[0].round;
    if (started[0] && now - started[0].tipoff < 18 * HOUR) return started[0].round;
    return (upcoming[0] ?? started[0]).round;
}
