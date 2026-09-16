// Shared by the price chart and the legend that sits above it, so a line and its
// legend swatch cannot drift apart. Its own module because a file that exports both
// a component and a helper breaks React fast refresh.

// Distinct hues rather than the position palette: colouring by position would give
// every line on a multi-player chart one of only three colours.
export const SERIES_COLORS = [
    '#8b5cf6', '#22d3ee', '#f59e0b', '#34d399', '#f472b6',
    '#60a5fa', '#fb923c', '#a3e635', '#e879f9', '#2dd4bf',
];

export const colorForIndex = (i) => SERIES_COLORS[i % SERIES_COLORS.length];

// Price movement, matching the tones the Price Tracker legend and player picker
// already use so a rise reads the same wherever it appears.
const TREND_UP = '#34d399';     // emerald-400
const TREND_DOWN = '#f87171';   // red-400
const TREND_FLAT = '#6b7280';   // gray-500

export const trendColor = (change) =>
    (change > 0 ? TREND_UP : change < 0 ? TREND_DOWN : TREND_FLAT);
