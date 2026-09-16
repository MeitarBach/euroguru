import { createContext, useContext } from 'react';

/**
 * The app-wide player-detail modal's opener.
 *
 * Split from the provider component because a module that exports both a component
 * and a hook breaks React fast refresh.
 */
export const PlayerDetailContext = createContext(null);

const noop = () => {};

/**
 * openPlayer(name, season) — opens the detail modal.
 *
 * Returns a no-op outside a provider, so a component can be rendered in isolation
 * (a test, a preview) without the whole app shell around it.
 */
export function useOpenPlayer() {
    const ctx = useContext(PlayerDetailContext);
    return ctx?.openPlayer ?? noop;
}
