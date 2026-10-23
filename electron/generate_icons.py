import struct
import zlib
import math
from pathlib import Path

def create_png(width: int, height: int, rgba_bytes: bytes) -> bytes:
    """Generate a valid PNG file from raw RGBA bytes."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    png = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png += chunk(b'IHDR', ihdr_data)

    stride = width * 4
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)
        raw_data.extend(rgba_bytes[y * stride : (y + 1) * stride])

    compressed = zlib.compress(bytes(raw_data), level=9)
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

def draw_sloth_template(size: int) -> bytes:
    """Draw a clean, cute sloth face template for macOS menu bar (black pixels + alpha)."""
    pixels = bytearray(size * size * 4)
    scale = size / 18.0

    def set_pixel(x, y, alpha=255):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            pixels[idx] = 0
            pixels[idx + 1] = 0
            pixels[idx + 2] = 0
            pixels[idx + 3] = alpha

    cx = size / 2.0 - 0.5
    cy = size / 2.0
    rx = 7.0 * scale
    ry = 6.2 * scale

    # Sloth head: rounded oval silhouette
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            if dx * dx + dy * dy <= 1.0:
                set_pixel(x, y, 255)

    # Sloth ears: cute small bumps on top left and right
    for y in range(size):
        for x in range(size):
            if math.hypot(x - (cx - 5.0 * scale), y - (cy - 4.5 * scale)) <= 2.0 * scale:
                set_pixel(x, y, 255)
            if math.hypot(x - (cx + 5.0 * scale), y - (cy - 4.5 * scale)) <= 2.0 * scale:
                set_pixel(x, y, 255)

    # Negative space cutouts:
    # 1. Iconic sloth eye stripes (angled down-outwards)
    for y in range(size):
        for x in range(size):
            # Left eye area
            lx = x - (cx - 3.2 * scale)
            ly = y - (cy - 0.5 * scale)
            rot_lx = lx * math.cos(0.4) + ly * math.sin(0.4)
            rot_ly = -lx * math.sin(0.4) + ly * math.cos(0.4)
            if (rot_lx / (1.2 * scale)) ** 2 + (rot_ly / (2.2 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 0)

            # Right eye area
            rx = x - (cx + 3.2 * scale)
            ry = y - (cy - 0.5 * scale)
            rot_rx = rx * math.cos(-0.4) + ry * math.sin(-0.4)
            rot_ry = -rx * math.sin(-0.4) + ry * math.cos(-0.4)
            if (rot_rx / (1.2 * scale)) ** 2 + (rot_ry / (2.2 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 0)

    # 2. Sloth nose
    for y in range(size):
        for x in range(size):
            nx = x - cx
            ny = y - (cy + 1.8 * scale)
            if (nx / (1.5 * scale)) ** 2 + (ny / (1.0 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 0)

    # 3. Smiling mouth
    for y in range(size):
        for x in range(size):
            mx = x - cx
            my = y - (cy + 3.4 * scale)
            if abs(mx) <= 2.0 * scale and abs(my - 0.25 * (mx ** 2) / scale) <= 0.6 * scale:
                set_pixel(x, y, 0)

    return bytes(pixels)

def draw_app_icon(size: int = 512) -> bytes:
    """Draw a modern rounded app icon badge for macOS/Windows with cute sloth face."""
    pixels = bytearray(size * size * 4)
    radius = size * 0.22
    margin = size * 0.06

    def set_pixel(x, y, r, g, b, a=255):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a

    # Gradient background
    for y in range(size):
        for x in range(size):
            in_x = margin <= x < size - margin
            in_y = margin <= y < size - margin
            if not (in_x and in_y):
                continue

            cx = margin + radius if x < margin + radius else (size - margin - radius if x > size - margin - radius else x)
            cy = margin + radius if y < margin + radius else (size - margin - radius if y > size - margin - radius else y)
            dist = math.hypot(x - cx, y - cy)
            if dist > radius:
                continue

            t = y / size
            r = int(14 + (30 - 14) * t)
            g = int(165 + (58 - 165) * t)
            b = int(233 + (138 - 233) * t)
            set_pixel(x, y, r, g, b, 255)

    # Draw white sloth silhouette in center
    cx = size / 2.0
    cy = size / 2.0 + 8
    scale = size / 36.0
    rx = 13.0 * scale
    ry = 11.5 * scale

    for y in range(size):
        for x in range(size):
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            if dx * dx + dy * dy <= 1.0:
                set_pixel(x, y, 255, 255, 255, 255)
            # Ears
            if math.hypot(x - (cx - 9.0 * scale), y - (cy - 8.5 * scale)) <= 3.8 * scale:
                set_pixel(x, y, 255, 255, 255, 255)
            if math.hypot(x - (cx + 9.0 * scale), y - (cy - 8.5 * scale)) <= 3.8 * scale:
                set_pixel(x, y, 255, 255, 255, 255)

    # Sloth eye patches (dark blue-slate)
    for y in range(size):
        for x in range(size):
            lx = x - (cx - 6.0 * scale)
            ly = y - (cy - 1.0 * scale)
            rot_lx = lx * math.cos(0.4) + ly * math.sin(0.4)
            rot_ly = -lx * math.sin(0.4) + ly * math.cos(0.4)
            if (rot_lx / (2.4 * scale)) ** 2 + (rot_ly / (4.4 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 15, 23, 42, 255)

            rx = x - (cx + 6.0 * scale)
            ry = y - (cy - 1.0 * scale)
            rot_rx = rx * math.cos(-0.4) + ry * math.sin(-0.4)
            rot_ry = -rx * math.sin(-0.4) + ry * math.cos(-0.4)
            if (rot_rx / (2.4 * scale)) ** 2 + (rot_ry / (4.4 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 15, 23, 42, 255)

            # Nose
            nx = x - cx
            ny = y - (cy + 3.2 * scale)
            if (nx / (2.8 * scale)) ** 2 + (ny / (2.0 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 15, 23, 42, 255)

            # Mouth
            mx = x - cx
            my = y - (cy + 6.2 * scale)
            if abs(mx) <= 3.8 * scale and abs(my - 0.25 * (mx ** 2) / scale) <= 1.0 * scale:
                set_pixel(x, y, 15, 23, 42, 255)

    return bytes(pixels)

def main():
    assets_dir = Path(__file__).parent / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # 18x18 sloth trayTemplate.png
    png18 = create_png(18, 18, draw_sloth_template(18))
    (assets_dir / "trayTemplate.png").write_bytes(png18)

    # 36x36 sloth trayTemplate@2x.png (Retina display)
    png36 = create_png(36, 36, draw_sloth_template(36))
    (assets_dir / "trayTemplate@2x.png").write_bytes(png36)

    # 512x512 app icon
    png512 = create_png(512, 512, draw_app_icon(512))
    (assets_dir / "icon.png").write_bytes(png512)

    print("Generated sloth trayTemplate.png (18x18), trayTemplate@2x.png (36x36), and icon.png (512x512) successfully.")

if __name__ == "__main__":
    main()
