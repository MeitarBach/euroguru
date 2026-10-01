import { auth } from './auth';
import { db } from './db';

/**
 * Settings that follow a signed-in user between devices.
 *
 * localStorage stays the one place the views read from, exactly as before; this keeps
 * a fixed set of its keys in step with two Supabase tables, both under row-level
 * security so a user only ever reaches their own rows:
 *
 *   user_settings  one row per user, a jsonb document of the small settings
 *   user_charts    one row per Court Vision chart, in display order
 *
 * Signed out, nothing here runs and the views behave as they always did.
 */

// localStorage key -> field of user_settings.settings.
const SETTINGS_FIELDS = {
    'euroguru.visibleColumns': 'statsColumns',
    'euroguru.recommendationColumns': 'recColumns',
    'euroguru.recommendationWeights': 'recWeights',
};
const CHARTS_KEY = 'euroguru.courtVision.charts';

export const SYNCED_KEYS = [...Object.keys(SETTINGS_FIELDS), CHARTS_KEY];

// Fired after the account's settings land in localStorage (or are cleared on sign-out),
// so mounted views can re-read.
export const PREFS_SYNCED_EVENT = 'euroguru:prefs-synced';

const PUSH_DELAY_MS = 1000;

const readLocal = (key) => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : undefined;
    } catch {
        return undefined;
    }
};

const writeLocal = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch { /* not fatal - the account still holds it */ }
};

const removeLocal = (key) => {
    try {
        window.localStorage.removeItem(key);
    } catch { /* nothing to clear */ }
};

const warn = (what, error) => console.warn(`[prefs] could not ${what}:`, error.message);

let userId = null;
let pushTimer = null;
// Saves run one at a time, in order, so a slow one cannot land after a newer one.
let queue = Promise.resolve();
// The charts as last written to the table. Charts are only re-sent when they differ,
// so changing a column does not rewrite every chart row.
let syncedCharts = null;

async function push() {
    pushTimer = null;
    const uid = userId;
    if (!db || !uid) return;

    const settings = {};
    for (const [key, field] of Object.entries(SETTINGS_FIELDS)) {
        const value = readLocal(key);
        if (value !== undefined) settings[field] = value;
    }
    const { error } = await db
        .from('user_settings')
        .upsert({ user_id: uid, settings }, { onConflict: 'user_id' });
    if (error) warn('save settings', error);

    const charts = readLocal(CHARTS_KEY);
    const snapshot = JSON.stringify(charts ?? null);
    if (!Array.isArray(charts) || snapshot === syncedCharts) return;

    const rows = charts.map(({ id, ...config }, position) => ({ user_id: uid, id, position, config }));
    if (rows.length) {
        const { error: upsertError } = await db
            .from('user_charts')
            .upsert(rows, { onConflict: 'user_id,id' });
        if (upsertError) return warn('save charts', upsertError);
    }

    // Whatever is no longer in the list was deleted on this device.
    let stale = db.from('user_charts').delete().eq('user_id', uid);
    if (rows.length) {
        const ids = rows.map(r => `"${String(r.id).replace(/"/g, '""')}"`).join(',');
        stale = stale.not('id', 'in', `(${ids})`);
    }
    const { error: deleteError } = await stale;
    if (deleteError) return warn('remove deleted charts', deleteError);

    syncedCharts = snapshot;
}

/** Call after writing any synced key; batches a burst of changes into one save. */
export function prefChanged() {
    if (!userId) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { queue = queue.then(push); }, PUSH_DELAY_MS);
}

/**
 * Bring the account's settings onto this device.
 *
 * The account wins where it has a value - it is what the user chose last, somewhere.
 * This device fills any gap, which on a first sign-in is everything: whatever was set
 * up here before signing in becomes the account's.
 */
async function pull(uid) {
    const [settingsRes, chartsRes] = await Promise.all([
        db.from('user_settings').select('settings').maybeSingle(),
        db.from('user_charts').select('id, position, config').order('position'),
    ]);
    if (settingsRes.error) return warn('load settings', settingsRes.error);
    if (chartsRes.error) return warn('load charts', chartsRes.error);
    if (uid !== userId) return; // signed out or switched account meanwhile

    const saved = settingsRes.data?.settings ?? {};
    let gaps = false;
    for (const [key, field] of Object.entries(SETTINGS_FIELDS)) {
        if (saved[field] !== undefined) writeLocal(key, saved[field]);
        else if (readLocal(key) !== undefined) gaps = true;
    }

    const rows = chartsRes.data ?? [];
    if (rows.length) {
        const charts = rows.map(r => ({ ...r.config, id: r.id }));
        writeLocal(CHARTS_KEY, charts);
        syncedCharts = JSON.stringify(charts);
    } else {
        syncedCharts = null;
        if (readLocal(CHARTS_KEY) !== undefined) gaps = true;
    }

    window.dispatchEvent(new Event(PREFS_SYNCED_EVENT));
    if (gaps) prefChanged();
}

auth?.onAuthStateChange((event, session) => {
    const next = session?.user?.id ?? null;

    if (event === 'SIGNED_OUT') {
        // Leave nothing of this account behind for whoever uses the browser next.
        clearTimeout(pushTimer);
        pushTimer = null;
        userId = null;
        syncedCharts = null;
        SYNCED_KEYS.forEach(removeLocal);
        window.dispatchEvent(new Event(PREFS_SYNCED_EVENT));
        return;
    }

    userId = next;
    if (!db || !next) return;

    // Pull on arriving signed in, never on USER_UPDATED or TOKEN_REFRESHED. auth-js
    // also re-emits SIGNED_IN when a tab regains focus, so a save still waiting to go
    // out wins over the account's older copy.
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && !pushTimer) {
        // Deferred out of the callback: auth-js holds a lock while it runs, and the
        // table requests read the session, which would wait on that same lock forever.
        setTimeout(() => { pull(next); }, 0);
    }
});
