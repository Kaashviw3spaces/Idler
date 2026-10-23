import struct
import zlib
import math
from pathlib import Path
from extract_sloth import read_png, write_png

def resize_rgba(src_w, src_h, src_bytes, dst_w, dst_h):
    """High-quality bilinear scaling of RGBA image."""
    dst_bytes = bytearray(dst_w * dst_h * 4)
    x_ratio = float(src_w - 1) / dst_w if dst_w > 0 else 0
    y_ratio = float(src_h - 1) / dst_h if dst_h > 0 else 0

    for y in range(dst_h):
        y_l = int(y_ratio * y)
        y_h = min(y_l + 1, src_h - 1)
        y_weight = (y_ratio * y) - y_l

        for x in range(dst_w):
            x_l = int(x_ratio * x)
            x_h = min(x_l + 1, src_w - 1)
            x_weight = (x_ratio * x) - x_l

            # 4 neighbors
            p1 = (y_l * src_w + x_l) * 4
            p2 = (y_l * src_w + x_h) * 4
            p3 = (y_h * src_w + x_l) * 4
            p4 = (y_h * src_w + x_h) * 4

            dst_idx = (y * dst_w + x) * 4
            for c in range(4):
                val = (src_bytes[p1 + c] * (1 - x_weight) * (1 - y_weight) +
                       src_bytes[p2 + c] * x_weight * (1 - y_weight) +
                       src_bytes[p3 + c] * (1 - x_weight) * y_weight +
                       src_bytes[p4 + c] * x_weight * y_weight)
                dst_bytes[dst_idx + c] = int(round(val))

    return dst_bytes

def main():
    assets_dir = Path(__file__).parent / 'assets'
    w, h, raw = read_png(str(assets_dir / 'sloth_extracted.png'))

    # Bounding box of the sloth
    x0, x1 = 28, 98
    y0, y1 = 48, 112
    crop_w = x1 - x0 + 1
    crop_h = y1 - y0 + 1

    # Extract crop into a square container with small padding
    dim = max(crop_w, crop_h) + 4
    sq_bytes = bytearray(dim * dim * 4) # initially all 0 (transparent)

    offset_x = (dim - crop_w) // 2
    offset_y = (dim - crop_h) // 2

    for y in range(crop_h):
        for x in range(crop_w):
            src_idx = ((y0 + y) * w + (x0 + x)) * 4
            dst_idx = ((offset_y + y) * dim + (offset_x + x)) * 4
            sq_bytes[dst_idx : dst_idx + 4] = raw[src_idx : src_idx + 4]

    assets_dir = Path(__file__).parent / 'assets'

    # 1. Full-color tray icons for macOS menu bar
    # 22x22 standard
    tray22 = resize_rgba(dim, dim, sq_bytes, 22, 22)
    write_png(22, 22, tray22, assets_dir / 'tray.png')

    # 44x44 Retina (@2x)
    tray44 = resize_rgba(dim, dim, sq_bytes, 44, 44)
    write_png(44, 44, tray44, assets_dir / 'tray@2x.png')

    # 2. Template icons (monochrome silhouette with alpha)
    # 18x18
    tray18 = resize_rgba(dim, dim, sq_bytes, 18, 18)
    # Convert RGB to black for template mode while preserving alpha
    tray18_tmpl = bytearray(tray18)
    for i in range(0, len(tray18_tmpl), 4):
        tray18_tmpl[i] = 0
        tray18_tmpl[i+1] = 0
        tray18_tmpl[i+2] = 0
    write_png(18, 18, tray18_tmpl, assets_dir / 'trayTemplate.png')

    # 36x36 Retina template (@2x)
    tray36 = resize_rgba(dim, dim, sq_bytes, 36, 36)
    tray36_tmpl = bytearray(tray36)
    for i in range(0, len(tray36_tmpl), 4):
        tray36_tmpl[i] = 0
        tray36_tmpl[i+1] = 0
        tray36_tmpl[i+2] = 0
    write_png(36, 36, tray36_tmpl, assets_dir / 'trayTemplate@2x.png')

    # 3. 512x512 App Icon with cute background squircle
    icon512 = bytearray(512 * 512 * 4)
    radius = 512 * 0.22
    margin = 512 * 0.06

    for y in range(512):
        for x in range(512):
            in_x = margin <= x < 512 - margin
            in_y = margin <= y < 512 - margin
            if not (in_x and in_y):
                continue

            cx = margin + radius if x < margin + radius else (512 - margin - radius if x > 512 - margin - radius else x)
            cy = margin + radius if y < margin + radius else (512 - margin - radius if y > 512 - margin - radius else y)
            dist = math.hypot(x - cx, y - cy)
            if dist > radius:
                continue

            # Blue to indigo gradient
            t = y / 512.0
            r = int(70 + (99 - 70) * t)
            g = int(120 + (80 - 120) * t)
            b = int(245 + (240 - 245) * t)
            idx = (y * 512 + x) * 4
            icon512[idx] = r
            icon512[idx + 1] = g
            icon512[idx + 2] = b
            icon512[idx + 3] = 255

    # Scale the sloth up to 360x360 and paste in center of the 512x512 squircle
    sloth360 = resize_rgba(dim, dim, sq_bytes, 360, 360)
    sx0 = (512 - 360) // 2
    sy0 = (512 - 360) // 2 + 8

    for y in range(360):
        for x in range(360):
            s_idx = (y * 360 + x) * 4
            sa = sloth360[s_idx + 3] / 255.0
            if sa > 0:
                d_idx = ((sy0 + y) * 512 + (sx0 + x)) * 4
                for c in range(3):
                    icon512[d_idx + c] = int(round(sloth360[s_idx + c] * sa + icon512[d_idx + c] * (1 - sa)))
                icon512[d_idx + 3] = 255

    write_png(512, 512, icon512, assets_dir / 'icon.png')
    print("All icons generated from the user's sloth successfully!")

if __name__ == '__main__':
    main()
