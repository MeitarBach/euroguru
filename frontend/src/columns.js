// Column metadata shared by the stats table and the Court Vision axis pickers.
//   aggKey    - field when showing averages; key - field in raw (per-game) mode
//   fmt       - 'num' 1dp, 'pct' appends %, 'sign' shows +/-, 'text' verbatim
//   cat       - grouping in the column picker
//   on        - part of the default fantasy-focused set
//   locked    - cannot be switched off (you always need to know who the row is)
//   axis      - how this column may be plotted: a numeric axis, a categorical one
//               (bar charts group by it), or 'none' for identities like the name
export const COLUMNS = [
    { id: 'PlayerName', axis: 'none', label: 'Player', key: 'PlayerName', align: 'left', fmt: 'player', cat: 'Essentials', on: true, locked: true },
    { id: 'position', axis: 'category', label: 'Pos', key: 'position', align: 'left', fmt: 'text', cat: 'Essentials', on: true,
      info: 'Position: G guard, F forward, C center.' },
    { id: 'Team', axis: 'category', label: 'Team', key: 'Team', align: 'left', fmt: 'text', cat: 'Essentials', on: true },
    { id: 'CR', axis: 'numeric', label: 'Cost (CR)', key: 'CR', align: 'right', fmt: 'num', cat: 'Essentials', on: true,
      info: 'Credits this player costs against your fantasy budget. Set by the game, and it moves during the season as form changes.' },
    { id: 'Score', axis: 'numeric', label: (m) => m, aggLabel: (m) => `Avg ${m}`, key: 'Score', aggKey: 'Average_Score', align: 'right', fmt: 'num', cat: 'Essentials', on: true, strong: true, pickerLabel: 'Score (PIR / FPT)',
      info: (m) => m === 'FPT'
        ? 'Fantasy points \u2014 what this player actually scores in the game you play.'
        : 'PIR (Performance Index Rating), EuroLeague\u2019s all-in-one rating: points, rebounds, assists, steals, blocks and fouls drawn, minus missed shots, turnovers, blocks against and fouls committed.' },

    { id: 'Minutes', axis: 'numeric', label: 'Min', aggLabel: 'Min', key: 'MinutesPlayed', aggKey: 'Average_Minutes', align: 'right', fmt: 'num', cat: 'Opportunity', on: true,
      info: 'Average minutes per game. Usually the single most predictive number here \u2014 a player can only produce while on court, so minutes cap everything else.' },
    { id: 'Starter', axis: 'numeric', label: 'Start%', aggLabel: 'Start%', key: null, aggKey: 'StarterPct', align: 'right', fmt: 'pct', cat: 'Opportunity', on: false,
      info: 'Share of games this player started. A secure starting spot usually means stable minutes.' },
    { id: 'MinTrend', axis: 'numeric', label: 'Min +/-', aggLabel: 'Min +/-', key: null, aggKey: 'MinutesTrend', align: 'right', fmt: 'sign', cat: 'Opportunity', on: false,
      info: 'Change in minutes over the last 3 games versus the season average. A rising role often shows up here before the scoring follows.' },

    { id: 'TS', axis: 'numeric', label: 'TS%', aggLabel: 'TS%', key: 'TS%', aggKey: 'Average_TS', align: 'right', fmt: 'pct', cat: 'Efficiency', on: true,
      info: 'True Shooting %: scoring efficiency counting twos, threes and free throws together. Points \u00f7 (2 \u00d7 (field goal attempts + 0.44 \u00d7 free throw attempts)). Around 55% is average, 60%+ is strong.' },
    { id: 'Per36', axis: 'numeric', label: 'Per 36', aggLabel: 'Per 36', key: null, aggKey: 'Per36_Score', align: 'right', fmt: 'num', cat: 'Efficiency', on: false,
      info: 'Score projected to 36 minutes, so a bench player and a starter can be compared on equal footing. Useful for spotting someone who would produce if given more court time.' },
    { id: 'AstTo', axis: 'numeric', label: 'AST/TO', aggLabel: 'AST/TO', key: 'AstTo', aggKey: 'Average_AstTo', align: 'right', fmt: 'num', cat: 'Efficiency', on: false,
      info: 'Assists per turnover. Ball security for playmakers \u2014 turnovers cost you points in fantasy scoring, so a low ratio quietly drags a guard down.' },

    { id: 'Usage', axis: 'numeric', label: 'Usage%', aggLabel: 'Usage%', key: 'Usage%', aggKey: 'Average_Usage', align: 'right', fmt: 'pct', cat: 'Involvement', on: true,
      info: 'Share of the team\u2019s possessions this player finishes while on court \u2014 shots, trips to the line and turnovers. High usage means the offence runs through them, which is what you want when a teammate is injured.' },
    { id: 'FGA', axis: 'numeric', label: 'FGA', aggLabel: 'Avg FGA', key: 'FGA', aggKey: 'Average_FGA', align: 'right', fmt: 'num', cat: 'Involvement', on: false,
      info: 'Field goal attempts per game \u2014 raw shot volume.' },

    { id: 'Value', axis: 'numeric', label: 'Value', aggLabel: 'Value', key: null, aggKey: 'Value', align: 'right', fmt: 'num3', cat: 'Value & form', on: true,
      info: 'Score per credit spent. The direct answer to "is this player worth their price" \u2014 sort by this to find bargains rather than just the best players.' },
    { id: 'StdDev', axis: 'numeric', label: 'StdDev', aggLabel: 'StdDev', key: null, aggKey: 'StdDev_Score', align: 'right', fmt: 'num', cat: 'Value & form', on: false, pickerLabel: 'Score volatility',
      info: 'Standard deviation of the score across games. Low means dependable, high means boom-or-bust \u2014 the x-axis of the Consistency chart.' },
    { id: 'Form', axis: 'numeric', label: 'Form', aggLabel: 'Form', key: null, aggKey: 'Form', align: 'right', fmt: 'sign', cat: 'Value & form', on: false,
      info: 'Last 3 games versus this player\u2019s own season average. Positive means they are heating up, negative means cooling off.' },
    { id: 'PlusMinus', axis: 'numeric', label: '+/-', aggLabel: '+/-', key: 'Plusminus', aggKey: 'Average_PlusMinus', align: 'right', fmt: 'sign', cat: 'Value & form', on: false,
      info: 'Team points scored minus points conceded while this player was on court. Captures impact that does not appear in the box score, but it is noisy over few games.' },

    { id: 'Points', axis: 'numeric', label: 'Pts', aggLabel: 'Avg Pts', key: 'Points', aggKey: 'Average_Points', align: 'right', fmt: 'num', cat: 'Box score', on: false },
    { id: 'Rebounds', axis: 'numeric', label: 'Reb', aggLabel: 'Avg Reb', key: 'TotalRebounds', aggKey: 'Average_Rebounds', align: 'right', fmt: 'num', cat: 'Box score', on: false },
    { id: 'Assists', axis: 'numeric', label: 'Ast', aggLabel: 'Avg Ast', key: 'Assistances', aggKey: 'Average_Assists', align: 'right', fmt: 'num', cat: 'Box score', on: false },
    { id: 'Steals', axis: 'numeric', label: 'Stl', aggLabel: 'Avg Stl', key: 'Steals', aggKey: 'Average_Steals', align: 'right', fmt: 'num', cat: 'Box score', on: false },
    { id: 'Blocks', axis: 'numeric', label: 'Blk', aggLabel: 'Avg Blk', key: 'BlocksFavour', aggKey: 'Average_Blocks', align: 'right', fmt: 'num', cat: 'Box score', on: false },
    { id: 'Turnovers', axis: 'numeric', label: 'TO', aggLabel: 'Avg TO', key: 'Turnovers', aggKey: 'Average_Turnovers', align: 'right', fmt: 'num', cat: 'Box score', on: false },

    { id: 'Games', axis: 'numeric', label: 'Round', aggLabel: 'Games', key: 'GameCode', aggKey: 'GamesPlayed', align: 'center', fmt: 'text', cat: 'Essentials', on: true, pickerLabel: 'Games played',
      info: 'How many games these averages are based on. A big number next to few games is a small sample, not a trend.' },
];

export const COLUMN_CATEGORIES = ['Essentials', 'Opportunity', 'Efficiency', 'Involvement', 'Value & form', 'Box score'];
export const DEFAULT_COLUMN_IDS = COLUMNS.filter(c => c.on).map(c => c.id);
const COLUMNS_STORAGE_KEY = 'euroguru.visibleColumns';

// Remembering the choice per browser is the whole point of letting someone pick.
// Storage can throw outright (private windows, blocked site data), so every access
// is guarded and simply falls back to the default set.
export const loadStoredColumns = () => {
    try {
        const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
        if (!raw) return DEFAULT_COLUMN_IDS;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_COLUMN_IDS;
        // Drop ids from an older build so a renamed column cannot strand the table.
        const known = parsed.filter(id => COLUMNS.some(c => c.id === id));
        return known.length ? known : DEFAULT_COLUMN_IDS;
    } catch {
        return DEFAULT_COLUMN_IDS;
    }
};

export const storeColumns = (ids) => {
    try {
        window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(ids));
    } catch {
        /* not fatal - the choice just will not survive a reload */
    }
};

const ALWAYS_SHOWN = new Set(['PlayerName', 'position', 'Team', 'CR', 'Score', 'Games']);

export const columnKey = (col, aggregated) => (aggregated ? (col.aggKey ?? col.key) : (col.key ?? col.aggKey));
export const columnLabel = (col, aggregated, metric) => {
    const label = aggregated ? (col.aggLabel ?? col.label) : col.label;
    return typeof label === 'function' ? label(metric) : label;
};
export const columnInfo = (col, metric) =>
    (typeof col.info === 'function' ? col.info(metric) : col.info);

// Formats a single cell. Uses ?? rather than || throughout: a legitimate 0 - a
// plus-minus of exactly zero, a scoreless night - must render as 0, not as a dash.
// The API sends null for "no data", and empty string never appears now that every
// endpoint goes through _json_safe.
export const formatCell = (value, fmt) => {
    if (value === null || value === undefined || value === '') return '-';
    if (fmt === 'text' || fmt === 'player') return value;
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(num)) return value;
    if (fmt === 'pct') return `${num.toFixed(1)}%`;
    if (fmt === 'num3') return num.toFixed(3);
    if (fmt === 'sign') return `${num > 0 ? '+' : ''}${num.toFixed(1)}`;
    return Number.isInteger(num) ? num : num.toFixed(1);
};


/** Guarded localStorage read. Storage can throw outright in private windows. */
export const loadStored = (key, fallback) => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
};

/** Guarded localStorage write; failure just means the choice will not survive a reload. */
export const storeValue = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch { /* ignore */ }
};

/** Columns usable as an axis of the given kind, given what the rows actually contain. */
export const axisColumns = (kind, rows) =>
    COLUMNS.filter(col => {
        if (col.axis !== kind) return false;
        const key = columnKey(col, true);
        if (!rows || !rows.length) return true;
        return rows.some(r => r[key] !== null && r[key] !== undefined && r[key] !== '');
    });
