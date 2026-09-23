import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../hooks/authContext';

/** The Google wordmark's G. Inlined because lucide carries no brand icons. */
function GoogleMark() {
    return (
        <svg viewBox="0 0 48 48" className="w-4 h-4 shrink-0" aria-hidden="true">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.3z" />
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.5 46 24 46z" />
            <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.2-2.9.7-4.3v-5.7H4.5C2.9 17.2 2 20.5 2 24s.9 6.8 2.5 9.7l7.3-5.4z" />
            <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.8 4.5 14.3l7.3 5.7c1.7-5.2 6.5-9.2 12.2-9.2z" />
        </svg>
    );
}

const FIELD = 'w-full px-3 py-2.5 rounded-lg bg-[#00000040] border border-[#ffffff10] '
    + 'text-sm text-white placeholder-gray-600 outline-none transition-colors '
    + 'focus:border-purple-500/60';

/**
 * Sign in or create an account, in one dialog.
 *
 * Raised from the sidebar on desktop and the header on phones; AuthProvider owns
 * whether it is open. The shell is PlayerDetailView's, which is already mobile-right:
 * a full-bleed sheet below sm, a centred card above it.
 */
export default function AuthModal({ onClose }) {
    const { signIn, signUp, signInWithGoogle } = useAuth();

    const [mode, setMode] = useState('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const isSignUp = mode === 'signup';

    const swap = () => {
        setMode(isSignUp ? 'signin' : 'signup');
        setError(null);
        setNotice(null);
    };

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);

        const result = isSignUp
            ? await signUp(email, password)
            : await signIn(email, password);

        if (result.error) {
            // Supabase's own wording is more use than anything generic we could write:
            // "Invalid login credentials" and "User already registered" are the two you
            // actually hit, and both tell you what to do next.
            setError(result.error.message);
            setBusy(false);
            return;
        }

        if (result.needsConfirmation) {
            setNotice(`Check ${email} for a confirmation link, then sign in.`);
            setBusy(false);
            return;
        }

        // A session now exists; the provider's listener has already picked it up.
        onClose();
    };

    const google = async () => {
        setBusy(true);
        setError(null);
        const { error: err } = await signInWithGoogle();
        // On success the browser is already navigating away, so only a failure lands
        // back here to be reported.
        if (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-0 sm:p-6"
            onClick={onClose}
        >
            <div
                className="glass-panel w-full max-w-md my-0 sm:my-8 p-5 sm:p-6 space-y-5 rounded-none sm:rounded-xl min-h-screen sm:min-h-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white">
                            {isSignUp ? 'Create your account' : 'Welcome back'}
                        </h2>
                        <p className="text-sm text-gray-400 mt-0.5">
                            {isSignUp
                                ? 'Save your picks and settings across devices.'
                                : 'Sign in to pick up where you left off.'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 -m-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#ffffff08] transition-colors"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <button
                    type="button"
                    onClick={google}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg
                               bg-white text-gray-800 text-sm font-medium
                               hover:bg-gray-100 disabled:opacity-60 transition-colors"
                >
                    <GoogleMark />
                    Continue with Google
                </button>

                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-[#ffffff10]" />
                    <span className="text-xs text-gray-600">or</span>
                    <div className="flex-1 h-px bg-[#ffffff10]" />
                </div>

                <form onSubmit={submit} className="space-y-3">
                    <div>
                        <label htmlFor="auth-email" className="block text-xs text-gray-500 mb-1.5">
                            Email
                        </label>
                        <input
                            id="auth-email"
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className={FIELD}
                        />
                    </div>

                    <div>
                        <label htmlFor="auth-password" className="block text-xs text-gray-500 mb-1.5">
                            Password
                        </label>
                        <input
                            id="auth-password"
                            type="password"
                            required
                            minLength={6}
                            autoComplete={isSignUp ? 'new-password' : 'current-password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={isSignUp ? 'At least 6 characters' : '••••••••'}
                            className={FIELD}
                        />
                    </div>

                    {error && (
                        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                            {error}
                        </p>
                    )}

                    {notice && (
                        <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                            {notice}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={busy}
                        className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-white
                                   bg-gradient-to-r from-purple-600 to-purple-500
                                   hover:from-purple-500 hover:to-purple-400
                                   disabled:opacity-60 transition-colors"
                    >
                        {busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
                    </button>
                </form>

                <p className="text-xs text-gray-500 text-center">
                    {isSignUp ? 'Already have an account?' : 'No account yet?'}{' '}
                    <button
                        type="button"
                        onClick={swap}
                        className="text-purple-400 hover:text-purple-300 font-medium"
                    >
                        {isSignUp ? 'Sign in' : 'Create one'}
                    </button>
                </p>
            </div>
        </div>
    );
}
