// Shared by every Matchups component: position colours (the same ones Court Vision
// draws with) and the diverging scale that colours a defense against the league.

export const POSITIONS = ['G', 'F', 'C'];
export const POSITION_NAMES = { G: 'Guards', F: 'Forwards', C: 'Centers' };
export const POSITION_COLORS = { G: '#8b5cf6', F: '#22d3ee', C: '#f59e0b' };

// Green for a soft defense - a good matchup, which is what the user is looking for -
// and red for a tough one. Full strength at 35% from the league average; most teams
// sit well inside that, so the outliers are the ones that stand out.
const SOFT = '34,197,94';
const TOUGH = '239,68,68';
const FULL_AT = 0.35;

export function heatStyle(value, average) {
    if (!average) return undefined;
    const d = (value - average) / average;
    const alpha = Math.min(Math.abs(d) / FULL_AT, 1) * 0.45;
    return { backgroundColor: `rgba(${d >= 0 ? SOFT : TOUGH}, ${alpha})` };
}

// "+16%" / "-8%": how far a value sits from a reference, rounded to whole percent.
export function pctVs(value, reference) {
    if (!reference) return '—';
    const d = Math.round((value / reference - 1) * 100);
    return `${d > 0 ? '+' : ''}${d}%`;
}
