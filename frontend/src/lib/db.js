import { PostgrestClient } from '@supabase/postgrest-js';
import { auth } from './auth';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Every request carries the signed-in user's access token, which is what row-level
 * security keys on: the tables only ever answer with the caller's own rows.
 *
 * Read per request rather than captured once, because auth-js refreshes the token
 * before it expires; getSession() reads it from storage, not over the network. With no
 * session the anon key is sent instead, which those tables refuse outright.
 */
const authedFetch = async (input, init = {}) => {
    const { data } = await auth.getSession();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${data?.session?.access_token ?? key}`);
    return fetch(input, { ...init, headers });
};

/**
 * Supabase's table API, or null when unconfigured. Every caller must handle null.
 *
 * PostgREST's own client rather than supabase-js, for the reason lib/auth.js gives:
 * the umbrella bundles realtime, storage and functions too, and this app now uses
 * exactly two of its clients - auth and this one.
 */
export const db = auth
    ? new PostgrestClient(`${url}/rest/v1`, {
        headers: { apikey: key },
        fetch: authedFetch,
    })
    : null;
