/**
 * Injury status vocabulary, in one place.
 *
 * The Rotowire feed reports exactly two meaningful statuses: "OUT" and the rather
 * long "Game Time Decision" - note it is spelled out, not "GTD". The backend's
 * add_injury_badge() applies the same two-value rule, compared case-insensitively.
 *
 * Both the dashboard's injury list and the player table's pill need a colour and a
 * short label for these, which is why they are defined here rather than twice.
 */

export const OUT = 'OUT';
export const GTD = 'Game Time Decision';

const STATUSES = {
    [OUT.toLowerCase()]: {
        key: OUT,
        label: OUT,
        short: 'OUT',
        dot: 'bg-red-500',
        text: 'text-red-400',
        chip: 'bg-red-500/15 text-red-400 border-red-500/30',
    },
    [GTD.toLowerCase()]: {
        key: GTD,
        label: GTD,
        // Abbreviated because the full string does not fit a 10px pill in the stats
        // table; the untruncated text goes in a title attribute at every call site.
        short: 'GTD',
        dot: 'bg-amber-500',
        text: 'text-amber-400',
        chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    },
};

const UNKNOWN = {
    key: '',
    label: '',
    short: '',
    dot: 'bg-gray-500',
    text: 'text-gray-400',
    chip: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

/**
 * Look up a raw status string.
 *
 * An unrecognised value still returns a usable entry, in neutral grey, carrying the
 * original text. A status the feed starts sending tomorrow should look unfamiliar,
 * never make a player vanish from the list.
 */
export function statusOf(raw) {
    const text = String(raw ?? '').trim();
    const hit = STATUSES[text.toLowerCase()];
    if (hit) return hit;
    return { ...UNKNOWN, key: text, label: text, short: text };
}

/** Sort key: ruled-out players first, then game-time decisions, then anything else. */
export function statusRank(raw) {
    const key = statusOf(raw).key;
    return key === OUT ? 0 : key === GTD ? 1 : 2;
}
