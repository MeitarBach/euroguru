import React, { useLayoutEffect, useRef } from 'react';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that counts to its new value and flashes green or red on the way.
 *
 * The tween writes straight to the element rather than through state: sixty renders a
 * second per card would be wasted work, and React never renders children here, so
 * nothing it does can fight the animation.
 */
export default function AnimatedNumber({ value, decimals = 1, duration = 650, className = '' }) {
    const ref = useRef(null);
    const shown = useRef(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const format = (v) => (v === null || v === undefined ? '–' : v.toFixed(decimals));
        const from = shown.current;
        const to = value ?? null;

        // A hidden tab gets no animation frames, so a tween started there would sit on
        // its first frame until the tab is shown - the number must simply be right.
        if (to === null || from === null || from === to || reducedMotion() || document.hidden) {
            shown.current = to;
            el.textContent = format(to);
            return undefined;
        }

        // Restart the flash even if the last one is still running.
        el.classList.remove('live-flash-up', 'live-flash-down');
        void el.offsetWidth;
        el.classList.add(to > from ? 'live-flash-up' : 'live-flash-down');

        const started = performance.now();
        let frame = requestAnimationFrame(function step(t) {
            const k = Math.min(1, (t - started) / duration);
            const v = from + (to - from) * (1 - (1 - k) ** 3);
            shown.current = k < 1 ? v : to;
            el.textContent = format(shown.current);
            if (k < 1) frame = requestAnimationFrame(step);
        });
        return () => cancelAnimationFrame(frame);
    }, [value, decimals, duration]);

    return <span ref={ref} className={`tabular-nums ${className}`} />;
}
