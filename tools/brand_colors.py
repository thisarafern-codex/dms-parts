#!/usr/bin/env python3
"""Compute WCAG-AAA-safe (7:1) tile colors from real brand colors.

Standalone helper, not run by the app or by build_seed.py — used by hand
whenever a new brand needs a colour in BRAND_COLORS (js/ui.js). For each
brand's true hex, produces a LIGHT-mode and DARK-mode tile background, each
paired with black or white text — whichever gives higher contrast —
adjusting lightness (HSL) only as far as needed to clear 7:1, so the tile
stays recognisably that brand's colour.

Only add a brand here with a real, sourced colour (official brand guideline,
or a widely-cited paint/livery colour) — never a guess. Add the hex to
BRANDS below, run this file, and copy the printed line into BRAND_COLORS.

    python3 tools/brand_colors.py
"""
import colorsys

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hex(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c))) for c in rgb)

def luminance(rgb):
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(rgb1, rgb2):
    l1, l2 = luminance(rgb1), luminance(rgb2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)

def best_text(bg_rgb):
    black = (0, 0, 0)
    white = (255, 255, 255)
    cb, cw = contrast(bg_rgb, black), contrast(bg_rgb, white)
    return (black, cb) if cb >= cw else (white, cw)

def adjust_to_ratio(hex_color, target=7.0, mode='light'):
    """Nudge HSL lightness until the better of black/white text hits target.
    mode='dark' biases toward a DARKER background suited to a dark theme
    (so it doesn't glare next to the app's near-black dark surfaces)."""
    r, g, b = hex_to_rgb(hex_color)
    h, l, s = colorsys.rgb_to_hls(r/255, g/255, b/255)[0], colorsys.rgb_to_hls(r/255, g/255, b/255)[1], colorsys.rgb_to_hls(r/255, g/255, b/255)[2]

    def make(l_val):
        rr, gg, bb = colorsys.hls_to_rgb(h, max(0, min(1, l_val)), s)
        return (rr*255, gg*255, bb*255)

    l_val = l
    if mode == 'dark':
        l_val = min(l_val, 0.34)  # dark tiles: keep it a deep, rich version of the hue

    bg = make(l_val)
    text, ratio = best_text(bg)
    tries = 0
    # Walk lightness toward whichever extreme increases contrast, in small steps.
    direction = -0.02 if text == (255, 255, 255) else 0.02  # white text -> darker bg; black text -> lighter bg
    while ratio < target and tries < 40:
        l_val += direction
        if l_val <= 0.03 or l_val >= 0.97:
            break
        bg = make(l_val)
        text, ratio = best_text(bg)
        tries += 1
    return rgb_to_hex(bg), rgb_to_hex(text), round(ratio, 2)


BRANDS = {
    # name: (hex, confidence)
    'Kubota':       ('#FF6600', 'high'),
    'Caterpillar':  ('#FFCD00', 'high'),
    'Doosan':       ('#0017A8', 'high'),
    'John Deere':   ('#367C2B', 'high'),
    'JCB':          ('#F9B101', 'high'),
    'Takeuchi':     ('#D00003', 'high'),
    'Hyundai':      ('#00287A', 'high'),
    'Komatsu':      ('#FFC800', 'medium'),
    'Hitachi':      ('#E8600A', 'medium'),
    'Kobelco':      ('#0089A9', 'medium'),
    'Yanmar':       ('#E2231A', 'medium'),
    'Bobcat':       ('#F04E23', 'medium'),
    'Mitsubishi':   ('#E60012', 'medium'),
    'Toro':         ('#DA291C', 'medium'),
}

if __name__ == "__main__":
    print("%-12s %-9s  %-30s %-30s" % ("brand", "conf", "light (bg/text/ratio)", "dark (bg/text/ratio)"))
    print("Copy the js-line into BRAND_COLORS in js/ui.js:\n")
    for name, (hexval, conf) in BRANDS.items():
        lb, lt, lr = adjust_to_ratio(hexval, 7.0, 'light')
        db, dt, dr = adjust_to_ratio(hexval, 7.0, 'dark')
        print("%-12s %-9s  %s/%s %5.2f:1        %s/%s %5.2f:1" % (name, conf, lb, lt, lr, db, dt, dr))
        print("    '%s': { bgL: '%s', fgL: '%s', bgD: '%s', fgD: '%s' }," %
              (name, lb, lt, db, dt))
