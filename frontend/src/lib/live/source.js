import { loadSchedule } from './schedule';
import { fetchGame, parseHeader, parseBoxscore } from './feed';

/**
 * Where live data comes from. The engine only ever talks to this shape, which is what
 * lets the demo replay (lib/live/demo.js) stand in for a real game day:
 *
 *   schedule()     -> every fixture of the season
 *   header(game)   -> parseHeader() output + lastModified
 *   boxscore(game) -> parseBoxscore() output + lastModified, or null before tip-off
 *   pollMs         -> how often to ask while a game is live
 */
export function euroleagueSource(seasonCode) {
    return {
        kind: 'live',
        // Euroleague's edge caches these answers for a while, so asking more often than
        // this would mostly return the same bytes.
        pollMs: 10_000,
        schedule: () => loadSchedule(seasonCode),
        header: async (game) => {
            const { data, lastModified } = await fetchGame('Header', game.code, seasonCode);
            return { ...parseHeader(data), lastModified };
        },
        boxscore: async (game) => {
            const { data, lastModified } = await fetchGame('Boxscore', game.code, seasonCode);
            const box = parseBoxscore(data);
            return box && { ...box, lastModified };
        },
    };
}
