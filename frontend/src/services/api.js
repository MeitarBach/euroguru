import axios from 'axios';
import { auth } from '../lib/auth';

// Relative by default so requests are same-origin (the dev server proxies /api to
// the backend), which avoids a CORS preflight on every JSON POST. Override with
// VITE_API_URL when the API lives elsewhere.
const API_URL = import.meta.env.VITE_API_URL ?? '/api';

// How long a response stays reusable. Data changes at most once a day, so this is
// really about the burst of identical requests a mount or a tab switch produces.
const CACHE_TTL_MS = 60_000;

const cache = new Map();
const inFlight = new Map();

/**
 * Our own axios instance, not the global one.
 *
 * The interceptor below attaches the user's access token, and a global interceptor
 * would attach it to every axios call anywhere in the app - including, one day, a
 * request to somebody else's API. Scoping it to the client that only ever talks to
 * our backend means the token cannot leak that way.
 */
const client = axios.create();

client.interceptors.request.use(async (config) => {
    if (!auth) return config;
    // Reads localStorage, and refreshes only when the token is near expiry - not a
    // network round trip per request.
    const { data } = await auth.getSession();
    const token = data?.session?.access_token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

/**
 * Which user the cached responses below belong to.
 *
 * No endpoint is personalised yet, so today this changes nothing. It is here for the
 * day one is: without it a response fetched while signed out could be replayed to a
 * signed-in user, or one user's data served to the next after a sign-out - the kind
 * of bug that surfaces as a support ticket rather than a stack trace.
 */
let authScope = 'anon';

auth?.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? 'anon';
    if (next === authScope) return;
    authScope = next;
    cache.clear();
    inFlight.clear();
});

/**
 * Run a request through the cache.
 *
 * Two things matter here beyond speed. Identical requests issued concurrently
 * share one promise, so a mount that asks for the same thing twice makes one
 * network call. And switching tabs unmounts a view entirely, so without this the
 * app refetched everything it already had.
 */
const cached = async (rawKey, request, fallback) => {
    // Scoped so a signed-in and a signed-out answer to the same question can never be
    // mistaken for each other.
    const key = `${authScope}|${rawKey}`;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = request()
        .then((response) => {
            cache.set(key, { value: response.data, at: Date.now() });
            return response.data;
        })
        .catch((error) => {
            console.error(`Error fetching ${rawKey}`, error);
            return fallback;
        })
        .finally(() => inFlight.delete(key));

    inFlight.set(key, promise);
    return promise;
};

/** Drop cached responses. Pass a substring to clear only matching entries. */
export const invalidate = (match) => {
    if (!match) return cache.clear();
    for (const key of cache.keys()) if (key.includes(match)) cache.delete(key);
};

export const fetchFilters = (season) =>
    cached(
        `filters:${season}`,
        () => client.get(`${API_URL}/filters`, { params: { season } }),
        { positions: [], min_cr: 0, max_cr: 35 }
    );

export const fetchStats = (params) =>
    cached(`stats:${JSON.stringify(params)}`, () => client.post(`${API_URL}/stats`, params), []);

export const fetchAggregatedStats = (params) =>
    cached(
        `aggregated:${JSON.stringify(params)}`,
        () => client.post(`${API_URL}/stats/aggregated`, params),
        []
    );

export const fetchDashboardData = (season) =>
    cached(
        `dashboard:${season}`,
        () => client.get(`${API_URL}/dashboard`, { params: { season } }),
        { widgets: {}, injuries: [] }
    );

export const fetchPlayerDetail = (name, season) =>
    cached(
        `player:${season}:${name}`,
        () => client.get(`${API_URL}/player`, { params: { name, season } }),
        { player: name, summary: {}, games: [] }
    );

export const fetchCrHistory = (season) =>
    cached(
        `crHistory:${season}`,
        () => client.get(`${API_URL}/cr-history`, { params: { season } }),
        { season, players: [] }
    );

export const fetchRecommendations = (params) =>
    cached(
        `recommend:${JSON.stringify(params)}`,
        () => client.post(`${API_URL}/recommend`, params),
        []
    );
