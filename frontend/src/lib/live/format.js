/** Small formatters for the Live tab. Times always render in the viewer's own zone. */

const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayOnly = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

export const tipoffTime = (ms) => timeOnly.format(ms);
export const tipoffDayTime = (ms) => dayTime.format(ms);
export const dayLabel = (ms) => dayOnly.format(ms);

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/** "19:00" today, "Fri 19:00" on another day. */
export const whenLabel = (ms, now) => (sameDay(ms, now) ? tipoffTime(ms) : tipoffDayTime(ms));

/** "2h 14m", "14m", "45s". */
export function countdown(ms) {
    const secs = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${secs}s`;
}

/** "just now", "12s ago", "3m ago". */
export function ago(ms) {
    const secs = Math.max(0, Math.round(ms / 1000));
    if (secs < 3) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
}

export const signed = (x) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`;

/** "S. Vezenkov" -> "Vezenkov", for tight spots like the feed. */
export const surnameOf = (name) => String(name ?? '').replace(/\s*\([^)]*\)$/, '').split(' ').slice(1).join(' ') || name;

/** One decimal, or two when a halved bench score needs them (6.65 stays 6.65). */
export const decimalsFor = (x) => (x !== null && x !== undefined && Math.abs(x * 10 - Math.round(x * 10)) > 1e-6 ? 2 : 1);
