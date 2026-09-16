import React, { useState, useCallback, useMemo } from 'react';
import PlayerDetailView from '../components/PlayerDetailView';
import { PlayerDetailContext } from './playerDetailContext';

/**
 * One player-detail modal for the whole app, openable from anywhere.
 *
 * A context rather than props because the click targets are scattered and some are
 * deep: a scatter point is a <circle> inside a recharts custom shape, three components
 * below the view that knows the season. Threading a callback down to it would touch
 * every chart component on the way for no benefit.
 *
 * The modal lives here rather than in each view so switching tabs cannot strand it -
 * App.jsx unmounts views entirely on a tab change.
 */
export function PlayerDetailProvider({ children }) {
    const [target, setTarget] = useState(null);

    const openPlayer = useCallback((name, season) => {
        if (!name) return;
        setTarget({ name, season });
    }, []);

    const close = useCallback(() => setTarget(null), []);

    // Memoised so every consumer does not re-render whenever the modal opens or shuts.
    const value = useMemo(() => ({ openPlayer }), [openPlayer]);

    return (
        <PlayerDetailContext.Provider value={value}>
            {children}
            {target && (
                // Keyed by player so the view's fetch effect re-runs cleanly when one
                // detail view is opened directly from another.
                <PlayerDetailView
                    key={`${target.season}:${target.name}`}
                    name={target.name}
                    season={target.season}
                    onClose={close}
                />
            )}
        </PlayerDetailContext.Provider>
    );
}
