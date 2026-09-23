import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { auth } from '../lib/auth';
import { AuthContext } from './authContext';
import AuthModal from '../components/AuthModal';

/**
 * Session state for the whole app, plus the one sign-in modal.
 *
 * The modal lives here rather than in App.jsx because two separate surfaces raise it -
 * the sidebar on desktop, the header on phones - and it follows the shape
 * PlayerDetailProvider already established: the provider owns the dialog, consumers
 * get an opener. Nothing else has to thread state.
 *
 * Deliberately not a gate. Children render whether or not anyone is signed in, because
 * most of EuroGuru is free; signing in is what will unlock the paid parts later, not
 * what grants entry.
 */
export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [open, setOpen] = useState(false);
    // Only ever true while a configured client is still reporting its first session.
    const [loading, setLoading] = useState(Boolean(auth));

    useEffect(() => {
        if (!auth) return;

        // One subscription does both jobs: auth-js emits INITIAL_SESSION on
        // subscribe, which seeds the state, and every later change keeps it current.
        // A separate getSession() call would race this one for no benefit.
        const { data } = auth.onAuthStateChange((_event, next) => {
            setSession(next);
            setLoading(false);
        });

        return () => data.subscription.unsubscribe();
    }, []);

    const openAuth = useCallback(() => setOpen(true), []);
    const closeAuth = useCallback(() => setOpen(false), []);

    const signIn = useCallback(async (email, password) => {
        if (!auth) return { error: new Error('Authentication is not configured.') };
        const { error } = await auth.signInWithPassword({ email, password });
        return { error };
    }, []);

    const signUp = useCallback(async (email, password) => {
        if (!auth) return { error: new Error('Authentication is not configured.') };
        const { data, error } = await auth.signUp({ email, password });
        // With "Confirm email" off, signUp returns a session and you are in. With it on
        // it returns a user and no session, and nothing happens until a link is clicked.
        // Reporting which one happened is what lets the modal say so instead of looking
        // like it silently failed.
        return { error, needsConfirmation: !error && !data?.session };
    }, []);

    const signInWithGoogle = useCallback(async () => {
        if (!auth) return { error: new Error('Authentication is not configured.') };
        const { error } = await auth.signInWithOAuth({
            provider: 'google',
            // Back to wherever the app is actually running, so this works unchanged on
            // localhost, on a preview deployment and in production. Each origin still
            // has to be listed in Supabase's redirect allow-list to be accepted.
            options: { redirectTo: window.location.origin },
        });
        return { error };
    }, []);

    const signOut = useCallback(async () => {
        if (!auth) return { error: null };
        const { error } = await auth.signOut();
        return { error };
    }, []);

    // Memoised so consumers do not all re-render whenever the modal opens or shuts.
    const value = useMemo(() => ({
        session,
        user: session?.user ?? null,
        loading,
        available: Boolean(auth),
        openAuth,
        closeAuth,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
    }), [session, loading, openAuth, closeAuth, signIn, signUp, signInWithGoogle, signOut]);

    return (
        <AuthContext.Provider value={value}>
            {children}
            {open && <AuthModal onClose={closeAuth} />}
        </AuthContext.Provider>
    );
}
