#!/usr/bin/env python3
"""Draw an original book-and-plus icon with only Python's standard library."""

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "extension" / "icons"


def inside_polygon(x, y, points):
    inside = False
    previous = points[-1]
    for current in points:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def inside_rounded_square(x, y, edge=8, radius=26):
    if x < edge or x > 128 - edge or y < edge or y > 128 - edge:
        return False
    cx = min(max(x, edge + radius), 128 - edge - radius)
    cy = min(max(y, edge + radius), 128 - edge - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def sample(x, y):
    if not inside_rounded_square(x, y):
        return (0, 0, 0, 0)
    color = (27, 136, 238, 255)
    if inside_polygon(x, y, [(28, 39), (60, 43), (60, 88), (31, 83)]):
        color = (245, 250, 255, 255)
    if inside_polygon(x, y, [(68, 43), (100, 39), (97, 83), (68, 88)]):
        color = (245, 250, 255, 255)
    if inside_polygon(x, y, [(30, 88), (61, 93), (61, 97), (28, 92)]):
        color = (190, 225, 255, 255)
    if inside_polygon(x, y, [(67, 93), (98, 88), (100, 92), (67, 97)]):
        color = (190, 225, 255, 255)
    if 62 <= x <= 66 and 42 <= y <= 96:
        color = (190, 225, 255, 255)
    if (x - 94) ** 2 + (y - 36) ** 2 <= 18**2:
        color = (13, 95, 169, 255)
    if 91 <= x <= 97 and 26 <= y <= 46 or 84 <= x <= 104 and 33 <= y <= 39:
        color = (255, 255, 255, 255)
    return color


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def render(size):
    sub = 8 if size == 16 else 4
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            samples = [
                sample((px + (sx + 0.5) / sub) * 128 / size,
                       (py + (sy + 0.5) / sub) * 128 / size)
                for sy in range(sub)
                for sx in range(sub)
            ]
            alpha = sum(p[3] for p in samples) / len(samples)
            if alpha:
                channels = [round(sum(p[c] * p[3] for p in samples) / (len(samples) * alpha))
                            for c in range(3)]
            else:
                channels = [0, 0, 0]
            rows.extend((*channels, round(alpha)))
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return header + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(rows, 9)) + png_chunk(b"IEND", b"")


if __name__ == "__main__":
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for pixels in (16, 48, 128):
        (ICON_DIR / f"icon{pixels}.png").write_bytes(render(pixels))
