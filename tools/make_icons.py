#!/usr/bin/env python3
"""Generate the app icons with no image library — stdlib zlib/struct only.

Draws an oil-filter silhouette: recognisable at 48px on a home screen, and
nothing to install on a machine that only has a bare Python.
"""

import os
import struct
import zlib

BG = (0x0a, 0x54, 0x8f)      # --accent
FG = (0xff, 0xff, 0xff)
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def png(path, width, height, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    body = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(body)
    return len(body)


def rounded(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x < x1 and y0 <= y < y1):
        return False
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        inx = (x < x0 + r) if cx == x0 + r else (x > x1 - r)
        iny = (y < y0 + r) if cy == y0 + r else (y > y1 - r)
        if inx and iny:
            return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return True


def draw(size, pad_ratio):
    """Filter canister: a tall rounded body with a narrower threaded collar."""
    pad = size * pad_ratio
    inner = size - 2 * pad
    bw = inner * 0.56                       # body width
    bx0 = (size - bw) / 2.0
    bx1 = bx0 + bw
    by0 = pad + inner * 0.26
    by1 = pad + inner
    cw = inner * 0.34                       # collar width
    cx0 = (size - cw) / 2.0
    cx1 = cx0 + cw
    cy0 = pad
    cy1 = by0 + inner * 0.04
    r = inner * 0.11

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            on = (rounded(x, y, bx0, by0, bx1, by1, r)
                  or rounded(x, y, cx0, cy0, cx1, cy1, r * 0.45))
            # Two grip bands across the body, drawn as background-coloured gaps.
            if on and by0 < y < by1:
                for frac in (0.42, 0.60):
                    band = by0 + (by1 - by0) * frac
                    if abs(y - band) < max(1.0, inner * 0.030):
                        on = False
            row.extend(FG if on else BG)
        rows.append(row)
    return rows


def main():
    out = os.path.join(HERE, "icons")
    if not os.path.isdir(out):
        os.makedirs(out)
    specs = [("icon-192.png", 192, 0.14),
             ("icon-512.png", 512, 0.14),
             ("icon-maskable-512.png", 512, 0.22)]   # maskable needs a safe zone
    for name, size, pad in specs:
        path = os.path.join(out, name)
        n = png(path, size, size, draw(size, pad))
        print("wrote icons/%-24s %5d bytes  %dx%d" % (name, n, size, size))


if __name__ == "__main__":
    main()
