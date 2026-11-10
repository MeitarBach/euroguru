// Small text helpers for the Live hub's widgets and dialogs.

/** What a new room's visibility means, under the form. */
export const visibilityNote = (v) => (v === 'public'
    ? 'Anyone signed in can find and join it (up to 200 teams).'
    : 'Only people with the invite link can join (up to 50 teams).');

/** "1st", "2nd", "3rd", "4th"… */
export const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
