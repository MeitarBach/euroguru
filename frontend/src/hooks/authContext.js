import { createContext, useContext } from 'react';
import { isConfigured } from '../lib/auth';

/**
 * Who is signed in, and the handful of actions that change that.
 *
 * Split from the provider component for the same reason playerDetailContext.js is:
 * a module exporting both a component and a hook breaks React fast refresh, and the
 * lint config here enforces it.
 */
export const AuthContext = createContext(null);

const unavailable = async () => ({
    error: new Error('Authentication is not configured in this build.'),
});

/**
 * The signed-out shape, used outside a provider and when Supabase is unconfigured.
 *
 * `loading: false` matters: a consumer that renders a spinner while loading would
 * otherwise spin forever in a build with no Supabase project behind it.
 */
const SIGNED_OUT = {
    user: null,
    session: null,
    loading: false,
    available: false,
    openAuth: () => {},
    closeAuth: () => {},
    signIn: unavailable,
    signUp: unavailable,
    signInWithGoogle: unavailable,
    signOut: unavailable,
};

/**
 * { user, session, loading, available, openAuth, closeAuth, signIn, signUp,
 *   signInWithGoogle, signOut }
 *
 * Safe outside a provider, so a component can be rendered in isolation without the
 * app shell around it - the same contract useOpenPlayer offers.
 *
 * `available` is false when this build has no Supabase config; hide account UI on it
 * rather than offering a button that cannot work.
 */
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) return SIGNED_OUT;
    return isConfigured ? ctx : { ...ctx, available: false };
}

/** Initials for an avatar bubble: "sasha.vezenkov@gmail.com" -> "SV". */
export function initialsFor(user) {
    const email = user?.email ?? '';
    const local = email.split('@')[0];
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (!parts.length) return '?';
    const letters = parts.length > 1
        ? parts[0][0] + parts[1][0]
        : parts[0].slice(0, 2);
    return letters.toUpperCase();
}
