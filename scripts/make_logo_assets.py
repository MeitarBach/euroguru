"""
Turn the supplied logo artwork into transparent PNGs the dark UI can use.

The three images that arrived are all opaque, and the app's background is #050507, so
dropped in as-is each one sits on the sidebar as a lit white panel. This strips the
background to real transparency.

    python scripts/make_logo_assets.py

Pure standard library - there is no PIL, matplotlib, imageio or cv2 in either the
backend venv or system Python, and a PNG needs nothing beyond zlib and struct.

Note on the source files: favicon.png is NOT used. Its "transparency" is a checkerboard
baked into the pixels - a screenshot of a transparent image that captured the editor's
grid - so as a favicon it would render a grey checked square. logo.png is the same
artwork on a clean white background, so it serves as the source for both outputs.
"""

import struct
import sys
import zlib
from pathlib import Path

SOURCES = Path.home() / "Downloads"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"

# How far a pixel may sit from the background colour and still count as background.
# Generous enough to catch the anti-aliased ring around the artwork, tight enough to
# leave the artwork's own light tones alone.
TOLERANCE = 32
# Below this distance a pixel is pure background; above FEATHER_TO it is pure artwork.
# In between the alpha ramps, which is what stops a hard cut from leaving a white fringe.
FEATHER_TO = 90


# ----------------------------------------------------------------------------- decode


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)


def decode_png(path):
    """(width, height, rows) with rows as RGBA bytearrays. Raises on anything exotic."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path.name} is not a PNG")

    idat, ihdr, i = b"", None, 8
    while i < len(data):
        (length,) = struct.unpack(">I", data[i:i + 4])
        kind = data[i + 4:i + 8]
        chunk = data[i + 8:i + 8 + length]
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
        i += 12 + length

    width, height, depth, colour, _, _, interlace = ihdr
    if depth != 8 or colour != 6 or interlace != 0:
        raise ValueError(
            f"{path.name}: expected 8-bit non-interlaced RGBA, got depth={depth} "
            f"colour_type={colour} interlace={interlace}"
        )

    raw = zlib.decompress(idat)
    bpp, stride = 4, width * 4
    rows, prev, pos = [], bytearray(stride), 0
    for _ in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype:  # 0 is unfiltered; skip the per-byte loop entirely
            for k in range(stride):
                a = line[k - bpp] if k >= bpp else 0
                b = prev[k]
                c = prev[k - bpp] if k >= bpp else 0
                x = line[k]
                if ftype == 1:
                    x += a
                elif ftype == 2:
                    x += b
                elif ftype == 3:
                    x += (a + b) >> 1
                elif ftype == 4:
                    x += _paeth(a, b, c)
                else:
                    raise ValueError(f"{path.name}: unknown filter type {ftype}")
                line[k] = x & 0xFF
        rows.append(line)
        prev = line
    return width, height, rows


# ----------------------------------------------------------------------------- encode


def encode_png(path, width, height, rows):
    """Write 8-bit RGBA, one unfiltered scanline per row."""
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter: None
        raw += row

    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


# -------------------------------------------------------------------------- transform


def strip_background(width, height, rows):
    """
    Clear the background to transparent, starting from the edges.

    A flood fill rather than a global colour match, because both images contain the
    background colour *inside* the artwork - white shirt folds in the lockup, light
    glints on the basketball. Matching globally would punch holes through them; only
    background connected to an edge is reachable here.
    """
    bg = tuple(rows[0][0:3])
    seen = bytearray(width * height)
    stack = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
    stack += [(0, y) for y in range(height)] + [(width - 1, y) for y in range(height)]

    def distance(x, y):
        off = x * 4
        px = rows[y]
        return max(abs(px[off] - bg[0]), abs(px[off + 1] - bg[1]), abs(px[off + 2] - bg[2]))

    cleared = 0
    while stack:
        x, y = stack.pop()
        if not (0 <= x < width and 0 <= y < height):
            continue
        idx = y * width + x
        if seen[idx]:
            continue
        seen[idx] = 1

        d = distance(x, y)
        if d > FEATHER_TO:
            continue  # solidly artwork - stop, and do not cross into it

        off = x * 4
        if d <= TOLERANCE:
            rows[y][off + 3] = 0
        else:
            # Partially covered edge pixel. Ramp alpha across the feather band so the
            # boundary fades out instead of cutting hard and leaving a pale fringe.
            alpha = min(255, int(255 * (d - TOLERANCE) / (FEATHER_TO - TOLERANCE)))
            rows[y][off + 3] = alpha

            # Recover the artwork's own colour. What is stored here is the artwork
            # already blended with the white background by the original anti-aliasing:
            #     stored = fg*a + bg*(1-a)
            # Leaving it would carry that white into the composite and ring the mark
            # with a pale glow on a near-black page. Solve back for fg. Below ~12%
            # coverage the division amplifies noise more than it recovers signal, and
            # the pixel is too faint to matter, so leave those alone.
            if alpha > 30:
                a = alpha / 255
                for ch in range(3):
                    fg = (rows[y][off + ch] - bg[ch] * (1 - a)) / a
                    rows[y][off + ch] = 0 if fg < 0 else (255 if fg > 255 else int(fg))
        cleared += 1
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return cleared


def crop_to_content(width, height, rows, pad=2):
    """Trim fully transparent margins so the mark can be sized by height in CSS."""
    top, bottom, left, right = height, -1, width, -1
    for y in range(height):
        row = rows[y]
        for x in range(width):
            if row[x * 4 + 3]:
                top, bottom = min(top, y), max(bottom, y)
                left, right = min(left, x), max(right, x)
    if bottom < 0:
        raise ValueError("every pixel was cleared - the key is too aggressive")

    top, left = max(0, top - pad), max(0, left - pad)
    bottom, right = min(height - 1, bottom + pad), min(width - 1, right + pad)
    out = [rows[y][left * 4:(right + 1) * 4] for y in range(top, bottom + 1)]
    return right - left + 1, bottom - top + 1, out


def pad_to_square(width, height, rows, margin=0.06):
    """
    Centre the artwork on a transparent square canvas.

    A favicon is drawn into a square box. Handing a browser a 381x541 portrait means
    it scales to fit the height and pillarboxes the rest, so the mark ends up narrower
    than the space allows and sits off-centre in some tab renderers. Squaring it up
    front keeps that decision here rather than leaving it to each browser.
    """
    side = int(max(width, height) * (1 + margin * 2))
    left, top = (side - width) // 2, (side - height) // 2
    blank = bytearray(side * 4)
    out = [bytearray(blank) for _ in range(side)]
    for y in range(height):
        out[top + y][left * 4:(left + width) * 4] = rows[y]
    return side, side, out


def build(source, dest, square=False):
    width, height, rows = decode_png(source)
    cleared = strip_background(width, height, rows)
    pct = 100 * cleared / (width * height)  # against the source, before cropping
    width, height, rows = crop_to_content(width, height, rows)
    if square:
        width, height, rows = pad_to_square(width, height, rows)
    encode_png(dest, width, height, rows)
    print(f"  {source.name:20s} -> {dest.name:18s} {width}x{height}  "
          f"{cleared:,} px cleared ({pct:.0f}% of source)  {dest.stat().st_size / 1024:.0f}KB")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("logo.png", "guru-mark.png", False),      # sidebar: sized by height
        ("logo.png", "guru-favicon.png", True),    # tab icon: must be square
        ("sidebar_image.png", "guru-lockup.png", False),
    ]
    missing = {s for s, _, _ in jobs if not (SOURCES / s).exists()}
    if missing:
        sys.exit(f"missing source image(s) in {SOURCES}: {', '.join(sorted(missing))}")
    for src, dst, square in jobs:
        build(SOURCES / src, OUT / dst, square)
