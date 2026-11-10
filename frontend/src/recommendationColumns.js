import { prefChanged } from './lib/prefs';
import { COLUMNS } from './columns';

/**
 * Columns for the Recommendations table.
 *
 * Four of them are produced only by the ranking - they do not exist on a stats row -
 * so they are defined here and then joined to the shared stat columns, which the
 * endpoint now returns alongside each recommendation. Same shape as columns.js so
 * ColumnPicker, columnKey, columnLabel and columnInfo all work unchanged.
 */
const RANKING_COLUMNS = [
    {
        id: 'RecScore', label: 'Score', key: 'RecScore', aggKey: 'RecScore',
        align: 'right', fmt: 'num2', cat: 'Ranking', on: true, locked: true, strong: true,
        pickerLabel: 'Recommendation score',
        info: 'The ranking itself, and what this table is sorted by. Combines recent scoring '
            + '(moved by the next matchup), value for money and consistency using the weights '
            + 'under Advanced Settings.',
    },
    {
        id: 'ExpWeightedScore', label: (m) => `Exp Weighted ${m}`, key: 'ExpWeightedScore',
        aggKey: 'ExpWeightedScore', align: 'right', fmt: 'num2', cat: 'Ranking', on: true,
        pickerLabel: 'Exp weighted score',
        info: (m) => `Recent ${m}, weighted so the latest games count most - the decay is the `
            + 'Alpha slider. A plain average treats a game from October the same as last night.',
    },
    {
        id: 'NextGameFPT', label: (m) => `Next game ${m}`, key: 'NextGameFPT', aggKey: 'NextGameFPT',
        align: 'right', fmt: 'num2', cat: 'Ranking',
        pickerLabel: 'Next game score',
        info: (m) => `Exp weighted ${m}, moved by the next opponent's defense against his position `
            + 'as much as the Matchup weight says. What the ranking scores him on, and what My '
            + 'Teams expects him to score on "Your formula".',
    },
    {
        id: 'Matchup', label: 'Matchup', key: 'MatchupFactor', aggKey: 'MatchupFactor',
        align: 'left', fmt: 'matchup', cat: 'Ranking',
        info: 'His next opponent, and how much that defense gives up to his position per 36 '
            + 'minutes against an average one: x1.10 is 10% more. Built from the rounds played '
            + 'so far, as on the Matchups tab.',
    },
    {
        id: 'Efficiency', label: 'Efficiency', key: 'Efficiency', aggKey: 'Efficiency',
        align: 'right', fmt: 'num3', cat: 'Ranking', on: true,
        info: 'Weighted score divided by cost: output per credit. High efficiency on a cheap '
            + 'player is what frees budget for a star elsewhere. Uses the next-game score.',
    },
    {
        id: 'StdErr', label: 'Std Error', key: 'StdErr', aggKey: 'StdErr',
        align: 'right', fmt: 'num2', cat: 'Ranking', on: true,
        pickerLabel: 'Standard error',
        info: 'How much the recent scores scatter, adjusted for how many games there are. '
            + 'Lower means the figure above it is more trustworthy; the Consistency weight '
            + 'decides how much that counts against a player.',
    },
    {
        id: 'PriceTrend', label: 'Price trend', key: 'PriceTrend', aggKey: 'PriceTrend',
        align: 'left', fmt: 'trend', cat: 'Ranking', on: true, sortable: false,
        info: 'How this player’s cost has moved across the season. A player still climbing '
            + 'is one the market has not finished repricing.',
    },
];

// The stats columns carry their own formatting and tooltips; Player is taken from the
// shared list rather than redefined. Round/Games is per-game and meaningless here,
// where every row is already an aggregate over the chosen window.
const SHARED = COLUMNS.filter(c => c.id !== 'Games');

const byId = (id) => RANKING_COLUMNS.find(c => c.id === id) ?? SHARED.find(c => c.id === id);

// Order matters: a column renders in this sequence, not in the order it was switched
// on. The first eight are the table's original layout, so turning nothing on leaves
// the tab looking exactly as it did; anything added lands after them.
export const REC_COLUMNS = [
    ...['PlayerName', 'position', 'CR', 'PriceTrend',
        'ExpWeightedScore', 'Efficiency', 'StdErr', 'RecScore', 'NextGameFPT', 'Matchup'].map(byId),
    ...SHARED.filter(c => !['PlayerName', 'position', 'CR'].includes(c.id)),
];

export const REC_COLUMN_CATEGORIES = [
    'Ranking', 'Essentials', 'Opportunity', 'Efficiency', 'Involvement', 'Value & form', 'Box score',
];

// Default: exactly what the table showed before it was configurable, so nothing moves
// for someone who never opens the picker.
export const REC_DEFAULT_IDS = [
    'PlayerName', 'position', 'CR', 'PriceTrend',
    'ExpWeightedScore', 'Efficiency', 'StdErr', 'RecScore',
];

const STORAGE_KEY = 'euroguru.recommendationColumns';

export const loadRecColumns = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return REC_DEFAULT_IDS;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) return REC_DEFAULT_IDS;
        // Drop ids from an older build so a renamed column cannot strand the table.
        const known = parsed.filter(id => REC_COLUMNS.some(c => c.id === id));
        return known.length ? known : REC_DEFAULT_IDS;
    } catch {
        return REC_DEFAULT_IDS;
    }
};

export const storeRecColumns = (ids) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
        /* not fatal - the choice just will not survive a reload */
    }
    prefChanged();
};

const WEIGHTS_KEY = 'euroguru.recommendationWeights';

/**
 * How the ranking is computed, before anyone changes it: the games window, the decay
 * (alpha), the three ranking weights and how much the next matchup counts. The matchup
 * default is backtested (DEFAULT_MATCHUP_WEIGHT in backend/utils/defense_vs_position.py,
 * which this must match). My Teams' "Your formula" reads the same settings: the window,
 * alpha and matchup weight give its expected FPT.
 */
export const REC_DEFAULT_WEIGHTS = Object.freeze({
    last_x_games: 5,
    alpha: 0.85,
    weight_efficiency: 2.0,
    weight_mean_pir: 1.0,
    weight_consistency: 1.0,
    weight_matchup: 0.3,
});
const WEIGHT_FIELDS = Object.keys(REC_DEFAULT_WEIGHTS);

/** The ranking settings last chosen, as a partial filters object; {} when none. */
export const loadRecWeights = () => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(WEIGHTS_KEY) || '{}');
        return Object.fromEntries(
            WEIGHT_FIELDS.filter(f => typeof saved?.[f] === 'number').map(f => [f, saved[f]])
        );
    } catch {
        return {};
    }
};

/** Saves only when something changed, so a mount does not trigger an account write. */
export const storeRecWeights = (weights) => {
    const next = Object.fromEntries(WEIGHT_FIELDS.map(f => [f, weights[f]]));
    if (JSON.stringify(next) === JSON.stringify(loadRecWeights())) return;
    try {
        window.localStorage.setItem(WEIGHTS_KEY, JSON.stringify(next));
    } catch {
        /* not fatal - the weights just will not survive a reload */
    }
    prefChanged();
};
