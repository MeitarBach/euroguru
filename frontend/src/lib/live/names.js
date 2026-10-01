/**
 * Matching a live boxscore line to the app's own player.
 *
 * The two feeds share no player id ("P011209" against Dunkest's 3791), so the join is
 * on (team, name) - a port of _join_name_parts and the two-pass merge in
 * backend/utils/data_processing.py, which matched 224 of 224 players on round 2.
 */

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);

/**
 * { initial, surname } for any spelling either feed uses.
 *
 * "LARKIN, SHANE", "Shane Larkin" and "S. Larkin" all reduce to S / LARKIN. The app's
 * own disambiguation suffix ("C. Jones (PAR)") is stripped first: it marks which of two
 * namesakes this is, and the team in the join already does that.
 */
export function nameParts(name) {
    let text = String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '');
    text = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase();
    text = text.replace(/-/g, ' ').replace(/['.]/g, '').replace(/\s+/g, ' ').trim();

    let first;
    let last;
    if (text.includes(',')) {
        [last, first] = [text.slice(0, text.indexOf(',')), text.slice(text.indexOf(',') + 1)];
    } else {
        const tokens = text.split(' ');
        [first, last] = tokens.length > 1 ? [tokens[0], tokens.slice(1).join(' ')] : ['', text];
    }
    const surname = last.split(' ').filter(w => w && !SUFFIXES.has(w)).join(' ').trim();
    return { initial: first.trim().slice(0, 1), surname };
}

/** Index rows by a key, keeping only keys that occur exactly once. */
function uniqueBy(rows, keyOf) {
    const seen = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        seen.set(key, seen.has(key) ? null : row);
    }
    return new Map([...seen].filter(([, row]) => row !== null));
}

/**
 * Pair one team's priced players with that team's boxscore lines.
 *
 * Returns Map(PlayerKey -> line). First pass: initial + surname. Second pass, for what
 * is left: surname alone, but only where it is unique on both sides - which recovers a
 * player the feeds call by different first names without ever choosing between two.
 */
export function matchLines(roster, lines) {
    const out = new Map();
    if (!roster?.length || !lines?.length) return out;

    const full = (parts) => `${parts.initial}|${parts.surname}`;
    const rosterParts = roster.map(p => ({ p, parts: nameParts(p.PlayerName) }));
    const lineParts = lines.map(l => ({ l, parts: nameParts(l.name) }));

    const linesByFull = uniqueBy(lineParts, x => full(x.parts));
    for (const [key, { p }] of uniqueBy(rosterParts, x => full(x.parts))) {
        const hit = linesByFull.get(key);
        if (hit) out.set(p.PlayerKey, hit.l);
    }

    // Uniqueness is judged across the whole team, not just what pass one left over,
    // exactly as the backend does: two JONESes on a squad make "JONES" mean nobody.
    const linesBySurname = uniqueBy(lineParts, x => x.parts.surname);
    for (const [surname, { p }] of uniqueBy(rosterParts, x => x.parts.surname)) {
        if (out.has(p.PlayerKey)) continue;
        const hit = linesBySurname.get(surname);
        if (hit) out.set(p.PlayerKey, hit.l);
    }
    return out;
}
