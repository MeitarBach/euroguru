/**
 * What signed-out visitors see of each gated surface, and what an account promises.
 *
 * Kept apart from Gate.jsx so the components file exports only components, which fast
 * refresh needs; the views import these limits directly.
 */

// Rows shown in full before the wall, per surface.
export const PREVIEW_ROWS = {
    stats: 10,
    recs: 3,
    gameLog: 3,
};

// Players a signed-out visitor can follow on the Live tab at once.
export const FREE_WATCH_LIMIT = 3;

// Blurred rows rendered under the preview. Enough to show that real data continues
// past the wall, without laying out hundreds of rows nobody can read.
export const BLURRED_ROWS = 6;

// Classes for a row past the preview: real data, unreadable, not interactive.
export const BLURRED_ROW = 'blur-[3px] select-none pointer-events-none opacity-70';

// Whether settings sync to the account (lib/prefs.js). Every surface that promises
// saved settings reads this one flag, so turning sync off retracts the claim everywhere.
export const SAVED_SETTINGS_LIVE = true;

export function accountBenefits() {
    return [
        'Free signup',
        'Full stats along with advanced metrics',
        ...(SAVED_SETTINGS_LIVE ? ['Your charts and settings saved across devices'] : []),
    ];
}
