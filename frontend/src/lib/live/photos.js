/**
 * A EuroLeague headshot or crest at the size it is shown.
 *
 * The originals are 670 KB PNG cutouts; their CDN resizes on request, and as WebP (which
 * keeps the transparent background) a 240px-wide headshot is about 20 KB - a whole team
 * on the court costs less than one original.
 */
export function photoUrl(url, width) {
    if (!url) return null;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}width=${Math.round(width)}&format=webp`;
}
