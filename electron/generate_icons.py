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

def draw_folder_template(size: int) -> bytes:
    """Draw a clean folder template for macOS menu bar (black pixels + alpha)."""
    pixels = bytearray(size * size * 4)
    scale = size / 18.0

    def set_pixel(x, y, alpha=255):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            pixels[idx] = 0
            pixels[idx + 1] = 0
            pixels[idx + 2] = 0
            pixels[idx + 3] = alpha

    x_min = int(2 * scale)
    x_max = int(16 * scale)
    y_min = int(3 * scale)
    y_tab_max = int(6 * scale)
    x_tab_max = int(8 * scale)
    y_body_min = int(5 * scale)
    y_max = int(15 * scale)

    for y in range(size):
        for x in range(size):
            in_tab = (x_min <= x <= x_tab_max) and (y_min <= y <= y_tab_max)
            in_body = (x_min <= x <= x_max) and (y_body_min <= y <= y_max)
            if in_tab or in_body:
                set_pixel(x, y, 255)

    return bytes(pixels)

def draw_app_icon(size: int = 512) -> bytes:
    """Draw a modern rounded app icon badge for macOS/Windows."""
    pixels = bytearray(size * size * 4)
    radius = size * 0.22  # rounded rect corner radius
    margin = size * 0.06

    def set_pixel(x, y, r, g, b, a=255):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a

    # Pre-render rounded rectangle background with gradient
    for y in range(size):
        for x in range(size):
            # Check rounded box bounds
            in_x = margin <= x < size - margin
            in_y = margin <= y < size - margin
            if not (in_x and in_y):
                continue

            # Check corners
            cx = margin + radius if x < margin + radius else (size - margin - radius if x > size - margin - radius else x)
            cy = margin + radius if y < margin + radius else (size - margin - radius if y > size - margin - radius else y)
            dist = math.hypot(x - cx, y - cy)
            if dist > radius:
                continue

            # Blue to Indigo gradient
            t = y / size
            r = int(14 + (30 - 14) * t)
            g = int(165 + (58 - 165) * t)
            b = int(233 + (138 - 233) * t)
            set_pixel(x, y, r, g, b, 255)

    # Draw stylized white folder in center
    f_scale = size / 32.0
    fx_min = int(8 * f_scale)
    fx_max = int(24 * f_scale)
    fy_min = int(10 * f_scale)
    fy_tab_max = int(13 * f_scale)
    fx_tab_max = int(15 * f_scale)
    fy_body_min = int(12 * f_scale)
    fy_max = int(22 * f_scale)

    for y in range(size):
        for x in range(size):
            in_tab = (fx_min <= x <= fx_tab_max) and (fy_min <= y <= fy_tab_max)
            in_body = (fx_min <= x <= fx_max) and (fy_body_min <= y <= fy_max)
            if in_tab or in_body:
                set_pixel(x, y, 255, 255, 255, 255)

    return bytes(pixels)

def main():
    assets_dir = Path(__file__).parent / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # Tray Template PNGs
    png18 = create_png(18, 18, draw_folder_template(18))
    (assets_dir / "trayTemplate.png").write_bytes(png18)

    png36 = create_png(36, 36, draw_folder_template(36))
    (assets_dir / "trayTemplate@2x.png").write_bytes(png36)

    # App Icon PNG (512x512)
    png512 = create_png(512, 512, draw_app_icon(512))
    (assets_dir / "icon.png").write_bytes(png512)

    print("Generated trayTemplate.png, trayTemplate@2x.png, and icon.png successfully.")

if __name__ == "__main__":
    main()

