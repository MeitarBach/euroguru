import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small "what is this" marker with an explanation.
 *
 * Rendered through a portal into document.body and positioned fixed, because the
 * stats table lives inside an overflow-x-auto container - a tooltip positioned
 * inside it would be clipped by the scroll box on the rightmost columns.
 *
 * Opens on hover *and* on tap. It used to be hover-only, which meant that on a phone
 * every one of these - one per column header - was dead: no hover event ever arrives,
 * so the entire stat-explanation feature was invisible on touch.
 */
export default function InfoTip({ text, className = '' }) {
    const [pos, setPos] = useState(null);

    const place = (element) => {
        const rect = element.getBoundingClientRect();
        // Keep the bubble inside the viewport; the rightmost columns would otherwise
        // push it off-screen.
        const half = 140;
        const x = Math.min(Math.max(rect.left + rect.width / 2, half + 8),
                           window.innerWidth - half - 8);
        setPos({ x, y: rect.bottom + 8 });
    };

    // A tap opens it; the next tap anywhere closes it. Without this a touch user can
    // open a tooltip but never dismiss it, since there is no pointer to move away.
    useEffect(() => {
        if (!pos) return undefined;
        const dismiss = () => setPos(null);
        const onKey = (e) => e.key === 'Escape' && setPos(null);
        // Deferred so the opening tap does not immediately close it.
        const id = setTimeout(() => {
            document.addEventListener('pointerdown', dismiss);
            window.addEventListener('keydown', onKey);
        }, 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener('pointerdown', dismiss);
            window.removeEventListener('keydown', onKey);
        };
    }, [pos]);

    return (
        <button
            type="button"
            // p-2 -m-2 grows the tap target to ~34px without moving the 14px dot: the
            // marker was previously the smallest interactive element in the app.
            className={`inline-flex items-center justify-center w-3.5 h-3.5 p-2 -m-2 box-content
                        rounded-full text-[9px] leading-none opacity-40 hover:opacity-100
                        transition-opacity cursor-help align-middle ${className}`}
            onMouseEnter={(e) => place(e.currentTarget)}
            onMouseLeave={() => setPos(null)}
            onClick={(event) => {
                // The header cell sorts on click; the marker must not trigger that.
                event.stopPropagation();
                event.preventDefault();
                setPos(pos ? null : undefined);
                if (!pos) place(event.currentTarget);
            }}
            aria-label={text}
        >
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-current">
                i
            </span>
            {pos && createPortal(
                <div
                    style={{ position: 'fixed', left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
                    className="z-[60] w-[min(280px,calc(100vw-16px))] rounded-lg bg-[#16161a] border border-white/10
                               shadow-xl px-3 py-2 text-xs leading-relaxed text-gray-300 normal-case font-normal
                               tracking-normal pointer-events-none"
                >
                    {text}
                </div>,
                document.body
            )}
        </button>
    );
}
