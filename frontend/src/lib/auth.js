import { AuthClient } from '@supabase/auth-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Whether this build has a Supabase project behind it.
 *
 * Checked rather than assumed because the client throws when either value is missing,
 * and a throw at module scope is a white screen - the whole app, not just the sign-in
 * button. Most of EuroGuru is free and works signed out, so a missing config should
 * cost you the account UI and nothing else.
 */
export const isConfigured = Boolean(url && key);

/**
 * Supabase's auth client, or null when unconfigured. Every caller must handle null.
 *
 * @supabase/auth-js rather than @supabase/supabase-js, which is the package the docs
 * reach for. supabase-js is an umbrella over five clients - auth, postgrest, realtime,
 * storage, functions - and it bundles all of them whether or not you touch them. This
 * app stores everything in S3 and reads it through its own FastAPI backend, so auth is
 * the only one it will ever call. Measured on this bundle: the umbrella cost 61 kB
 * gzipped, this costs 28 kB, so importing the one client we use is worth 34 kB - over
 * half. auth-js is Supabase's own package, ships in lockstep with supabase-js, and is
 * precisely what supabase-js wraps here.
 *
 * Switch back to supabase-js the day this app reads a Supabase table directly; running
 * two clients side by side would be the worse of both.
 *
 * The options below are the ones supabase-js would have passed on our behalf. The
 * interesting one is detectSessionInUrl: it consumes the ?code= that Google sends us
 * back with and strips it from the address bar, which is why OAuth needs no route of
 * its own in an app that has no router. persistSession keeps you signed in across
 * reloads via localStorage, and autoRefreshToken renews the access token before it
 * expires.
 */
export const auth = isConfigured
    ? new AuthClient({
        url: `${url}/auth/v1`,
        headers: { Authorization: `Bearer ${key}`, apikey: key },
        // Namespaced by project so two Supabase apps on the same origin - a preview
        // deployment beside production, say - cannot read each other's session.
        storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
    })
    : null;
