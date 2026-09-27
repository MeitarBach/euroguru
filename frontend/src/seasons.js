/**
 * The seasons the app knows about, in one place.
 *
 * The list and its labels used to be written out in four files - the dashboard's
 * SEASON_LABEL map plus an identical block of <option>s in Stats, Court Vision and
 * Recommendations - which is how those views came to disagree about which season to
 * open on: the dashboard had moved to 2026-27 while the other three still started on
 * the finished 2025-26.
 *
 * Newest first, because that is the order the selectors show them in and the first
 * entry is the one a view opens on.
 */
export const SEASONS = [
    { value: '2026', label: '2026-27' },
    { value: '2025', label: '2025-26' },
    { value: '2024', label: '2024-25' },
    { value: '2023', label: '2023-24' },
];

/** The season every view opens on. */
export const CURRENT_SEASON = SEASONS[0].value;

/** The one before it, which the dashboard offers as a fallback while the new one is empty. */
export const PREVIOUS_SEASON = SEASONS[1].value;

/** '2026' -> '2026-27', for labelling a season the user picked. */
export const SEASON_LABEL = Object.fromEntries(SEASONS.map(s => [s.value, s.label]));
