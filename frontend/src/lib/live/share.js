/**
 * Sharing a group: an invite link that carries the group itself, and a branded image of
 * its live standings. Every share is a small ad for EuroGuru, which is the point.
 *
 * The link needs no server: the group (name, players, bench, captain) is encoded in the
 * URL, and opening it offers to add the group on the reader's own device.
 */

const SITE = 'https://eurogurufantasy.com';

const toBase64Url = (text) => btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (code) => decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/'))));

// PlayerKeys are "id:3791"; the link carries just the numbers.
const id = (key) => Number(String(key).replace(/^id:/, ''));
const key = (n) => `id:${n}`;

export function inviteLink(group) {
    const payload = {
        n: group.name,
        k: group.keys.map(id).filter(Number.isFinite),
        b: (group.bench ?? []).map(id),
        c: group.captain ? id(group.captain) : undefined,
    };
    const origin = typeof window !== 'undefined' ? window.location.origin : SITE;
    return `${origin}/?join=${toBase64Url(JSON.stringify(payload))}`
        + '&utm_source=share&utm_medium=invite&utm_campaign=live-group';
}

/** The group in a ?join= link, or null. */
export function readInvite(search = window.location.search) {
    const code = new URLSearchParams(search).get('join');
    if (!code) return null;
    try {
        const raw = JSON.parse(fromBase64Url(code));
        const keys = (raw.k ?? []).filter(Number.isFinite).map(key);
        if (!keys.length) return null;
        return {
            name: String(raw.n ?? 'Shared group').slice(0, 24),
            keys,
            bench: (raw.b ?? []).filter(Number.isFinite).map(key),
            captain: Number.isFinite(raw.c) ? key(raw.c) : null,
        };
    } catch {
        return null;
    }
}

/** Drop ?join= (and the UTM tags that came with it) once it has been handled. */
export function clearInvite() {
    const url = new URL(window.location.href);
    ['join', 'utm_source', 'utm_medium', 'utm_campaign'].forEach(p => url.searchParams.delete(p));
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
});

const fmt = (x) => (Math.abs(x * 10 - Math.round(x * 10)) > 1e-6 ? x.toFixed(2) : x.toFixed(1));

/**
 * A 1080x1080 card of a group's standings - square, so it suits X, WhatsApp and
 * Instagram alike. Drawn on a canvas in the browser; returns a PNG Blob.
 */
export async function groupCard(group, round) {
    const S = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const g = canvas.getContext('2d');
    const font = (weight, size) => `${weight} ${size}px Inter, -apple-system, "Helvetica Neue", Arial, sans-serif`;

    g.fillStyle = '#050507';
    g.fillRect(0, 0, S, S);
    for (const [x, y, r, color] of [[120, 60, 620, 'rgba(139,92,246,0.45)'], [S, S, 560, 'rgba(236,72,153,0.22)']]) {
        const glow = g.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, color);
        glow.addColorStop(1, 'rgba(5,5,7,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, S, S);
    }

    const mascot = await loadImage('/guru-mark.png');
    if (mascot) g.drawImage(mascot, 64, 56, 52 * (mascot.width / mascot.height), 52);
    g.fillStyle = '#fff';
    g.font = font(800, 34);
    g.fillText('EuroGuru', 136, 95);
    g.font = font(700, 20);
    g.fillStyle = '#e9d5ff';
    const badge = round ? `ROUND ${round} · LIVE` : 'LIVE';
    g.fillText(badge, S - 64 - g.measureText(badge).width, 92);

    g.fillStyle = group.colorHex || '#a78bfa';
    g.beginPath();
    g.arc(78, 176, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = font(800, 52);
    g.fillText(group.name, 104, 194);
    g.font = font(800, 120);
    const total = fmt(group.sums.total);
    const totalWidth = g.measureText(total).width;
    g.fillText(total, 64, 330);
    g.font = font(600, 30);
    g.fillStyle = '#a1a1aa';
    g.fillText('fantasy points', 64 + totalWidth + 18, 330);
    g.fillText(`${group.rows.length} players${group.sums.live ? ` · ${group.sums.live} playing now` : ''}`, 64, 380);

    const rows = group.rows.slice(0, 8);
    rows.forEach((row, i) => {
        const y = 430 + i * 66;
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.beginPath();
        g.roundRect(56, y, S - 112, 56, 14);
        g.fill();
        g.fillStyle = '#c4b5fd';
        g.font = font(800, 20);
        g.fillText(row.player.position || '', 80, y + 36);
        g.fillStyle = '#fff';
        g.font = font(700, 28);
        const role = row.captain ? '  (C)' : row.benched ? '  (bench)' : '';
        g.fillText(`${row.player.PlayerName}${role}`, 130, y + 38);
        g.font = font(800, 30);
        const value = row.counted === null ? '–' : fmt(row.counted);
        g.fillText(value, S - 80 - g.measureText(value).width, y + 39);
    });

    g.fillStyle = 'rgba(139,92,246,0.35)';
    g.fillRect(0, S - 84, S, 84);
    g.fillStyle = '#fff';
    g.font = font(800, 30);
    g.fillText('eurogurufantasy.com', 64, S - 32);
    g.font = font(500, 24);
    g.fillStyle = '#ddd6fe';
    const pitch = 'Follow your fantasy team live';
    g.fillText(pitch, S - 64 - g.measureText(pitch).width, S - 34);

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Share a group: the native share sheet with the image and invite link where the device
 * supports it (phones), otherwise download the image and copy the link. Returns a short
 * message for the UI.
 */
export async function shareGroup(group, round) {
    const link = inviteLink(group);
    const text = `${group.name}: ${fmt(group.sums.total)} fantasy points${round ? ` in Round ${round}` : ''}. Follow it live on EuroGuru 👇`;
    const blob = await groupCard(group, round);
    const file = blob && new File([blob], `${group.name.replace(/\W+/g, '-') || 'group'}-euroguru.png`, { type: 'image/png' });

    if (file && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], text: `${text}\n${link}` });
            return 'Shared';
        } catch (err) {
            if (err?.name === 'AbortError') return null;
        }
    }
    if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    try {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        return 'Image downloaded, invite link copied';
    } catch {
        return 'Image downloaded';
    }
}
