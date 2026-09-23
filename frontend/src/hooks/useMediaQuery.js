import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query currently matches, as reactive state.
 *
 * Tailwind handles anything that is purely a style, and should keep doing so - this
 * is for the cases where the *content* differs, not just its appearance. Abbreviating
 * a player's name is one: CSS cannot rewrite text.
 *
 * useSyncExternalStore rather than useState+useEffect so the first render already has
 * the right answer. Reading it in an effect would render the long name once and then
 * swap it, which shows up as a visible reflow on every table row.
 */
export default function useMediaQuery(query) {
    return useSyncExternalStore(
        (onChange) => {
            const list = window.matchMedia(query);
            list.addEventListener('change', onChange);
            return () => list.removeEventListener('change', onChange);
        },
        () => window.matchMedia(query).matches,
        // Server-side there is no viewport; assume the wide layout.
        () => false,
    );
}

/** True below Tailwind's `md`, i.e. where the mobile layout is in effect. */
export const useIsNarrow = () => useMediaQuery('(max-width: 767px)');
