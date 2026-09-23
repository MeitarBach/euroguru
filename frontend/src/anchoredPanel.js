/**
 * Where a portal-rendered dropdown should sit so it stays on screen.
 *
 * The pickers used to clamp one edge only - `Math.min(anchor.x, innerWidth - 340)` -
 * which on a viewport narrower than the panel goes negative and hangs the panel off
 * the left of the screen. `top` was not clamped at all, so a trigger low on the page
 * opened a panel below the fold.
 *
 * Returns fixed-position coordinates. The panel should also cap its own width at
 * `min(<width>px, calc(100vw - 16px))` so it never exceeds a narrow viewport.
 */
const GAP = 8;

export function anchoredPosition(anchor, width, height = 0) {
    if (!anchor) return null;

    const maxLeft = window.innerWidth - width - GAP;
    // max() last so it wins on a viewport narrower than the panel: pinned to the left
    // edge and clipped on the right beats sliding off-screen entirely.
    const left = Math.max(GAP, Math.min(anchor.x, maxLeft));

    // Flip above the trigger when there is not room below it, but only if that is
    // genuinely roomier - otherwise stay put and let the panel's own max-height scroll.
    let top = anchor.y;
    if (height) {
        const below = window.innerHeight - anchor.y;
        if (below < height && anchor.above > height) top = anchor.above - height;
        else top = Math.max(GAP, Math.min(anchor.y, window.innerHeight - height - GAP));
    }
    return { position: 'fixed', left, top };
}

/** Capture a trigger's geometry for anchoredPosition. */
export function anchorFrom(element) {
    const r = element.getBoundingClientRect();
    // `above` is where the panel's bottom would sit if it opened upward.
    return { x: r.left, y: r.bottom + GAP, above: r.top - GAP };
}
