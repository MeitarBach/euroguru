import React, { useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small "what is this" marker with a hover explanation.
 *
 * Rendered through a portal into document.body and positioned fixed, because the
 * stats table lives inside an overflow-x-auto container - a tooltip positioned
 * inside it would be clipped by the scroll box on the rightmost columns.
 */
export default function InfoTip({ text, className = '' }) {
    const [pos, setPos] = useState(null);

    const show = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        // Keep the bubble inside the viewport; the rightmost columns would otherwise
        // push it off-screen.
        const half = 140;
        const x = Math.min(Math.max(rect.left + rect.width / 2, half + 8),
                           window.innerWidth - half - 8);
        setPos({ x, y: rect.bottom + 8 });
    };

    return (
        <span
            className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-current
                        text-[9px] leading-none opacity-40 hover:opacity-100 transition-opacity cursor-help
                        align-middle ${className}`}
            onMouseEnter={show}
            onMouseLeave={() => setPos(null)}
            // The header cell sorts on click; the marker must not trigger that.
            onClick={(event) => event.stopPropagation()}
            aria-label={text}
        >
            i
            {pos && createPortal(
                <div
                    style={{ position: 'fixed', left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
                    className="z-[60] w-[280px] rounded-lg bg-[#16161a] border border-white/10 shadow-xl
                               px-3 py-2 text-xs leading-relaxed text-gray-300 normal-case font-normal
                               tracking-normal pointer-events-none"
                >
                    {text}
                </div>,
                document.body
            )}
        </span>
    );
}
