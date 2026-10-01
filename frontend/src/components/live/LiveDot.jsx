import React from 'react';

/** The pulsing marker for something happening right now. */
export default function LiveDot({ color = 'red', size = 2 }) {
    const tone = color === 'green' ? 'bg-emerald-400' : 'bg-red-500';
    const ring = color === 'green' ? 'bg-emerald-400' : 'bg-red-400';
    const box = size === 2 ? 'h-2 w-2' : 'h-2.5 w-2.5';
    return (
        <span className={`relative inline-flex shrink-0 ${box}`}>
            <span className={`absolute inline-flex h-full w-full rounded-full ${ring} opacity-70 animate-ping motion-reduce:animate-none`} />
            <span className={`relative inline-flex rounded-full ${box} ${tone}`} />
        </span>
    );
}
