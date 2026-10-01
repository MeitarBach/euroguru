import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';
import { signed, surnameOf } from '../../lib/live/format';

const MotionLi = motion.li;

function When({ event }) {
    const at = new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const clock = [event.period, event.clock].filter(Boolean).join(' ');
    return <span className="text-[10px] text-gray-600 font-mono shrink-0 w-14 pt-0.5">{clock || at}</span>;
}

/** What just happened to your players, newest first. */
export default function ActivityFeed({ events, nameOf }) {
    return (
        <div className="glass-panel p-4">
            <h3 className="font-semibold text-gray-200 flex items-center gap-2 mb-3">
                <Zap size={16} className="text-amber-300" /> Activity
            </h3>
            {events.length === 0 ? (
                <p className="text-sm text-gray-500">
                    Scoring plays for the players you watch show up here as they happen.
                </p>
            ) : (
                <ul className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    <AnimatePresence initial={false}>
                        {events.map(event => (
                            <MotionLi
                                key={event.id}
                                layout
                                initial={{ opacity: 0, y: -10, backgroundColor: 'rgba(139,92,246,0.18)' }}
                                animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(139,92,246,0)' }}
                                transition={{ duration: 0.6 }}
                                className="flex items-start gap-2 text-sm rounded-md px-1 -mx-1 py-0.5"
                            >
                                <When event={event} />
                                {event.kind === 'player' ? (
                                    <span className="min-w-0 flex-1 text-gray-300">
                                        <span className="text-white font-medium">{surnameOf(nameOf(event.key))}</span>{' '}
                                        <span className="text-gray-400">{event.parts.join(' · ') || 'stat correction'}</span>
                                    </span>
                                ) : (
                                    <span className="min-w-0 flex-1 text-gray-500 italic">{event.text}</span>
                                )}
                                {event.kind === 'player' && event.delta !== 0 && (
                                    <span className={`shrink-0 font-mono text-xs font-semibold px-1.5 py-0.5 rounded ${
                                        event.delta > 0 ? 'text-emerald-300 bg-emerald-500/10' : 'text-red-300 bg-red-500/10'}`}
                                    >
                                        {signed(event.delta)}
                                    </span>
                                )}
                            </MotionLi>
                        ))}
                    </AnimatePresence>
                </ul>
            )}
        </div>
    );
}
