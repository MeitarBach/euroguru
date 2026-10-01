/**
 * Euroleague's live game feed, read directly from the browser.
 *
 * live.euroleague.net is CORS-open and sits behind Cloudflare, which keeps answering
 * from its own cache however often it is asked - so polling it from every viewer's
 * browser costs Euroleague nothing, and costs us no server at all.
 */

const LIVE_API = 'https://live.euroleague.net/api';
const REQUEST_TIMEOUT_MS = 8000;

export class RateLimitedError extends Error {}

/**
 * One endpoint for one game: { data, lastModified }. `data` is null before the game
 * has any (both endpoints answer an empty 200 until shortly before tip-off).
 *
 * `cache: 'no-store'` matters: the responses say max-age=60, so the browser would
 * otherwise answer every poll for a minute from its own copy.
 */
export async function fetchGame(endpoint, gameCode, seasonCode) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(
            `${LIVE_API}/${endpoint}?gamecode=${gameCode}&seasoncode=${seasonCode}`,
            { cache: 'no-store', signal: controller.signal },
        );
        if (res.status === 429) throw new RateLimitedError(`${endpoint} ${gameCode}: rate limited`);
        if (!res.ok) throw new Error(`${endpoint} ${gameCode}: HTTP ${res.status}`);
        const text = await res.text();
        return {
            data: text.trim() ? JSON.parse(text) : null,
            // When Euroleague's edge last rebuilt this answer - the honest age of the data.
            lastModified: Date.parse(res.headers.get('last-modified') ?? '') || null,
        };
    } finally {
        clearTimeout(timer);
    }
}

const num = (value) => {
    const n = Number(String(value ?? '').trim());
    return Number.isFinite(n) ? n : 0;
};

function periodLabel(quarter) {
    if (!quarter) return null;
    if (quarter <= 4) return `Q${quarter}`;
    return quarter === 5 ? 'OT' : `OT${quarter - 4}`;
}

/**
 * The game's state: status ('scheduled' | 'live' | 'final'), period, clock and score.
 *
 * Parsed defensively: the field formats during a live game are taken from the feed's
 * documentation by example, and a value that does not parse degrades to "Live" without
 * a clock rather than to a wrong one.
 */
export function parseHeader(header) {
    if (!header) return { status: 'scheduled' };

    const scoreHome = num(header.ScoreA);
    const scoreAway = num(header.ScoreB);
    const quarter = parseInt(String(header.Quarter ?? '').replace(/\D/g, ''), 10) || null;
    const clock = /^\d{1,2}:\d{2}$/.test(String(header.RemainingPartialTime ?? '').trim())
        ? String(header.RemainingPartialTime).trim()
        : null;

    let status = 'scheduled';
    if (header.Live) status = 'live';
    else if (scoreHome + scoreAway > 0) status = 'final';

    let label = periodLabel(quarter);
    if (status === 'live' && clock === '00:00' && quarter) {
        label = quarter === 2 ? 'Half-time' : `End of ${periodLabel(quarter)}`;
    }
    // Between periods the feed blanks Quarter, leaving only the game time elapsed to
    // say which one just ended: 10:00 is the end of Q1, 40:00 of regulation, and each
    // overtime adds five minutes.
    const elapsed = /^(\d+):\d{2}$/.exec(String(header.GameTime ?? '').trim());
    if (status === 'live' && !quarter && elapsed && Number(elapsed[1]) > 0) {
        const minutes = Number(elapsed[1]);
        const ended = minutes <= 40 ? Math.round(minutes / 10) : 4 + Math.round((minutes - 40) / 5);
        label = ended === 2 ? 'Half-time' : `End of ${periodLabel(ended)}`;
    }

    return {
        status,
        scoreHome,
        scoreAway,
        quarter,
        period: label,
        clock: status === 'live' && clock !== '00:00' ? clock : null,
    };
}

/** One player's line, in the app's own vocabulary. */
function lineOf(p) {
    const minutes = String(p.Minutes ?? '').trim();
    return {
        id: String(p.Player_ID ?? '').trim(),
        name: String(p.Player ?? '').trim(),
        code: String(p.Team ?? '').trim(),
        number: String(p.Dorsal ?? '').trim(),
        starter: Boolean(num(p.IsStarter)),
        onCourt: Boolean(num(p.IsPlaying)),
        dnp: !minutes || minutes.toUpperCase() === 'DNP',
        min: minutes,
        pts: num(p.Points),
        reb: num(p.TotalRebounds),
        oreb: num(p.OffensiveRebounds),
        dreb: num(p.DefensiveRebounds),
        ast: num(p.Assistances),
        stl: num(p.Steals),
        blk: num(p.BlocksFavour),
        blka: num(p.BlocksAgainst),
        tov: num(p.Turnovers),
        pf: num(p.FoulsCommited), // the API's own spelling
        fd: num(p.FoulsReceived),
        fgm2: num(p.FieldGoalsMade2),
        fga2: num(p.FieldGoalsAttempted2),
        fgm3: num(p.FieldGoalsMade3),
        fga3: num(p.FieldGoalsAttempted3),
        ftm: num(p.FreeThrowsMade),
        fta: num(p.FreeThrowsAttempted),
        pir: num(p.Valuation),
        pm: num(p.Plusminus),
    };
}

/** Every player line in a boxscore, or null when the game has none yet. */
export function parseBoxscore(box) {
    if (!box?.Stats?.length) return null;
    return {
        live: Boolean(box.Live),
        lines: box.Stats.flatMap(team => (team.PlayersStats ?? []).map(lineOf)),
    };
}

export const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Fantasy points, exactly as the EuroLeague Fantasy game awards them: PIR, plus 10% of
 * its size for a player whose team won. Derived from the stored rounds rather than
 * documentation - it reproduces every one of them - so a negative PIR on a winning
 * team improves by 10% (-3 becomes -2.7).
 */
export const fantasyPoints = (pir, won) => round1(pir + (won ? 0.1 * Math.abs(pir) : 0));

/** The bonus a win would add to this PIR. */
export const winBonus = (pir) => round1(0.1 * Math.abs(pir));
