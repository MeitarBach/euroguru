import axios from 'axios';

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
 * Run a request through the cache.
 *
 * Two things matter here beyond speed. Identical requests issued concurrently
 * share one promise, so a mount that asks for the same thing twice makes one
 * network call. And switching tabs unmounts a view entirely, so without this the
 * app refetched everything it already had.
 */
const cached = async (key, request, fallback) => {
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
            console.error(`Error fetching ${key}`, error);
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
        () => axios.get(`${API_URL}/filters`, { params: { season } }),
        { positions: [], min_cr: 0, max_cr: 35 }
    );

export const fetchStats = (params) =>
    cached(`stats:${JSON.stringify(params)}`, () => axios.post(`${API_URL}/stats`, params), []);

export const fetchAggregatedStats = (params) =>
    cached(
        `aggregated:${JSON.stringify(params)}`,
        () => axios.post(`${API_URL}/stats/aggregated`, params),
        []
    );

export const fetchDashboardData = (season) =>
    cached(
        `dashboard:${season}`,
        () => axios.get(`${API_URL}/dashboard`, { params: { season } }),
        { widgets: {}, injuries: [] }
    );

export const fetchPlayerDetail = (name, season) =>
    cached(
        `player:${season}:${name}`,
        () => axios.get(`${API_URL}/player`, { params: { name, season } }),
        { player: name, summary: {}, games: [] }
    );

export const fetchCrHistory = (season) =>
    cached(
        `crHistory:${season}`,
        () => axios.get(`${API_URL}/cr-history`, { params: { season } }),
        { season, players: [] }
    );

export const fetchRecommendations = (params) =>
    cached(
        `recommend:${JSON.stringify(params)}`,
        () => axios.post(`${API_URL}/recommend`, params),
        []
    );
