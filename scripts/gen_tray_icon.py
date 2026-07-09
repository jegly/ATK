#!/usr/bin/env python3
"""Generates the ATK tray icon assets from a hand-specified vector path (no
image libraries available offline - this rasterizes and encodes PNG/ICO from
scratch using only the stdlib). Re-run after editing PATH_D or COLORS.

Outputs into assets/:
  tray_icon.png          32x32 RGBA, ATK green - Windows/Linux tray icon
  tray_icon_template.png 32x32 RGBA, black silhouette - macOS template icon
  tray_icon.ico           16 + 32px, ATK green - Windows .ico container
  tray_symbolic.svg       vector, single-fill - Linux icon-theme install
"""
import re
import struct
import zlib
import os

# Material Design "alternate_email" (@) glyph, 24x24 viewBox. Single source of
# truth for every rasterized/vector output below.
PATH_D = (
    "M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10c1.28,0 2.5,-0.2 3.68,-0.68l-0.36,-1.9"
    "C14.34,19.79 13.19,20 12,20c-4.41,0 -8,-3.59 -8,-8s3.59,-8 8,-8s8,3.59 8,8v0.9"
    "c0,0.61 -0.6,1.32 -1.5,1.32s-1.5,-0.71 -1.5,-1.32V8h-2v0.68"
    "C14.42,8.24 13.51,8 12.5,8C10.02,8 8,10.02 8,12.5s2.02,4.5 4.5,4.5"
    "c1.14,0 2.17,-0.42 2.96,-1.11c0.55,0.66 1.42,1.11 2.29,1.11"
    "c1.66,0 3.25,-1.34 3.25,-3.32V12C21,6.48 16.52,2 12,2z"
    "M12.5,15c-1.38,0 -2.5,-1.12 -2.5,-2.5s1.12,-2.5 2.5,-2.5s2.5,1.12 2.5,2.5"
    "S13.88,15 12.5,15z"
)
VIEWBOX = 24

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def tokenize(d):
    return re.findall(r"[MmLlHhVvCcSsZz]|-?\d*\.?\d+(?:[eE]-?\d+)?", d)


def flatten_cubic(p0, p1, p2, p3, segs=20):
    pts = []
    for i in range(1, segs + 1):
        t = i / segs
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def parse_path(d):
    """Returns a flat list of (x1,y1,x2,y2) edges (line segments), flattening
    beziers, across every subpath - enough for a nonzero-winding scanline fill."""
    tokens = tokenize(d)
    i = 0
    cmd = None
    cx = cy = 0.0
    start_x = start_y = 0.0
    last_ctrl = None
    edges = []

    def line_to(nx, ny):
        edges.append((cx, cy, nx, ny))

    while i < len(tokens):
        tok = tokens[i]
        if tok in "MmLlHhVvCcSsZz":
            cmd = tok
            i += 1

        if cmd in ("M", "m"):
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            if cmd == "m":
                x += cx
                y += cy
            cx, cy = x, y
            start_x, start_y = x, y
            cmd = "L" if cmd == "M" else "l"  # subsequent pairs are implicit lineto
        elif cmd in ("L", "l"):
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            if cmd == "l":
                x += cx
                y += cy
            line_to(x, y)
            cx, cy = x, y
        elif cmd in ("H", "h"):
            x = float(tokens[i])
            i += 1
            if cmd == "h":
                x += cx
            line_to(x, cy)
            cx = x
        elif cmd in ("V", "v"):
            y = float(tokens[i])
            i += 1
            if cmd == "v":
                y += cy
            line_to(cx, y)
            cy = y
        elif cmd in ("C", "c"):
            x1, y1, x2, y2, x, y = (float(tokens[i + k]) for k in range(6))
            i += 6
            if cmd == "c":
                x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy
            for px, py in flatten_cubic((cx, cy), (x1, y1), (x2, y2), (x, y)):
                edges.append((cx, cy, px, py))
                cx, cy = px, py
            last_ctrl = (x2, y2)
        elif cmd in ("S", "s"):
            x2, y2, x, y = (float(tokens[i + k]) for k in range(4))
            i += 4
            if cmd == "s":
                x2 += cx; y2 += cy; x += cx; y += cy
            if last_ctrl:
                x1, y1 = 2 * cx - last_ctrl[0], 2 * cy - last_ctrl[1]
            else:
                x1, y1 = cx, cy
            for px, py in flatten_cubic((cx, cy), (x1, y1), (x2, y2), (x, y)):
                edges.append((cx, cy, px, py))
                cx, cy = px, py
            last_ctrl = (x2, y2)
        elif cmd in ("Z", "z"):
            line_to(start_x, start_y)
            cx, cy = start_x, start_y
        else:
            raise ValueError(f"unhandled path command {cmd!r}")
    return edges


def winding_at(x, y, edges):
    w = 0
    for x1, y1, x2, y2 in edges:
        if y1 == y2:
            continue
        if (y1 <= y < y2) or (y2 <= y < y1):
            t = (y - y1) / (y2 - y1)
            xi = x1 + t * (x2 - x1)
            if xi > x:
                w += 1 if y2 > y1 else -1
    return w


def rasterize(edges, size, supersample=4):
    """Nonzero-winding scanline fill -> size x size alpha coverage (0..255),
    antialiased via `supersample`x supersampling + box downsample."""
    hi = size * supersample
    scale = hi / VIEWBOX
    scaled = [(x1 * scale, y1 * scale, x2 * scale, y2 * scale) for x1, y1, x2, y2 in edges]
    coverage = [[0] * hi for _ in range(hi)]
    for y in range(hi):
        fy = y + 0.5
        # crossings for this scanline, sorted, with winding deltas
        xs = []
        for x1, y1, x2, y2 in scaled:
            if y1 == y2:
                continue
            if (y1 <= fy < y2) or (y2 <= fy < y1):
                t = (fy - y1) / (y2 - y1)
                xi = x1 + t * (x2 - x1)
                xs.append((xi, 1 if y2 > y1 else -1))
        xs.sort()
        w = 0
        row = coverage[y]
        for idx in range(len(xs)):
            xi, d = xs[idx]
            prev_w = w
            w += d
            if prev_w == 0 and w != 0:
                span_start = xi
            elif prev_w != 0 and w == 0:
                x0 = max(0, int(round(span_start)))
                x1_ = min(hi, int(round(xi)))
                for px in range(x0, x1_):
                    row[px] = 1
    # box downsample
    out = [[0] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            s = 0
            for dy in range(supersample):
                row = coverage[y * supersample + dy]
                for dx in range(supersample):
                    s += row[x * supersample + dx]
            out[y][x] = round(255 * s / (supersample * supersample))
    return out


def to_rgba(coverage, size, rgb):
    r, g, b = rgb
    buf = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            a = coverage[y][x]
            o = (y * size + x) * 4
            buf[o] = r
            buf[o + 1] = g
            buf[o + 2] = b
            buf[o + 3] = a
    return bytes(buf)


def write_png(path, size, rgba):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def write_ico(path, frames):
    """frames: list of (size, png_bytes)"""
    count = len(frames)
    header = struct.pack("<HHH", 0, 1, count)
    entries = b""
    blob = b""
    offset = 6 + count * 16
    for size, png_bytes in frames:
        wb = size if size < 256 else 0
        hb = size if size < 256 else 0
        entries += struct.pack("<BBBBHHII", wb, hb, 0, 0, 1, 32, len(png_bytes), offset)
        blob += png_bytes
        offset += len(png_bytes)
    with open(path, "wb") as f:
        f.write(header)
        f.write(entries)
        f.write(blob)


def main():
    edges = parse_path(PATH_D)
    os.makedirs(ASSETS, exist_ok=True)

    green = (0, 255, 136)   # ATK accent green #00ff88
    black = (0, 0, 0)

    sizes = [16, 32]
    green_pngs = {}
    for size in sizes:
        cov = rasterize(edges, size)
        rgba = to_rgba(cov, size, green)
        green_pngs[size] = rgba
        write_png(os.path.join(ASSETS, f"_tray_preview_{size}.png"), size, rgba)

    # Primary tray icon (32px, colored) for Windows/Linux.
    write_png(os.path.join(ASSETS, "tray_icon.png"), 32, green_pngs[32])

    # macOS template icon: solid black silhouette, alpha only. macOS recolors
    # this automatically for the light/dark menu bar.
    cov32 = rasterize(edges, 32)
    tmpl_rgba = to_rgba(cov32, 32, black)
    write_png(os.path.join(ASSETS, "tray_icon_template.png"), 32, tmpl_rgba)

    # Windows .ico, 16 + 32px, PNG-compressed frames (Vista+ format).
    ico_frames = []
    for size in sizes:
        tmp_path = os.path.join(ASSETS, f"_ico_tmp_{size}.png")
        write_png(tmp_path, size, green_pngs[size])
        with open(tmp_path, "rb") as f:
            ico_frames.append((size, f.read()))
        os.remove(tmp_path)
    write_ico(os.path.join(ASSETS, "tray_icon.ico"), ico_frames)

    # Linux tray icon: a StatusNotifierItem IconName resolved via an app-owned
    # IconThemePath (not the user's ~/.local/share/icons - no cache to
    # invalidate). Convention and fill colour (#bebebe) copied directly from
    # /opt/frequency/icons/frequency-tray-symbolic.svg, a working reference on
    # this exact machine: GNOME Shell recolors any such named symbolic icon to
    # monochrome at render time regardless of source colour, so the exact
    # shade doesn't matter - what matters is shipping a NAME the shell resolves
    # itself rather than raw pixmap bytes (which is what breaks on GNOME's
    # AppIndicator extension per Cascade's README).
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" '
        f'viewBox="0 0 {VIEWBOX} {VIEWBOX}"><path d="{PATH_D}" fill="#bebebe"/></svg>\n'
    )
    with open(os.path.join(ASSETS, "atk-tray-symbolic.svg"), "w") as f:
        f.write(svg)

    print("Wrote tray_icon.png, tray_icon_template.png, tray_icon.ico, atk-tray-symbolic.svg")
    print("Preview files: assets/_tray_preview_16.png, assets/_tray_preview_32.png (delete after checking)")


if __name__ == "__main__":
    main()
