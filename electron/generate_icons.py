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

def draw_hanging_sloth_template(size: int) -> bytes:
    """Draw a clean, cute full-body sloth hanging upside down from the top edge."""
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

    # 1. Arms reaching up to corners (y=0..6)
    for y in range(int(7 * scale)):
        # Left arm diagonal
        lx = int(2.0 * scale + y * 0.7)
        for dx in range(int(2.4 * scale)):
            set_pixel(lx + dx, y, 255)
        # Right arm diagonal
        rx = int(size - 3.0 * scale - y * 0.7)
        for dx in range(int(2.4 * scale)):
            set_pixel(rx - dx, y, 255)

    # 2. Claws gripping the top edge (y=0..1)
    for x in range(int(1.5 * scale), int(5.0 * scale)):
        set_pixel(x, 0, 255)
        set_pixel(x, 1, 255)
    for x in range(int(size - 5.0 * scale), int(size - 1.5 * scale)):
        set_pixel(x, 0, 255)
        set_pixel(x, 1, 255)

    # 3. Head in center (y=4..11)
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / (4.2 * scale)
            dy = (y - 7.5 * scale) / (3.6 * scale)
            if dx * dx + dy * dy <= 1.0:
                set_pixel(x, y, 255)

    # 4. Body / belly hanging below head (y=9..16)
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / (5.0 * scale)
            dy = (y - 12.8 * scale) / (3.8 * scale)
            if dx * dx + dy * dy <= 1.0:
                set_pixel(x, y, 255)

    # 5. Feet / hind limbs at sides (y=11..15)
    for y in range(int(11 * scale), int(15 * scale)):
        for x in range(int(1.5 * scale), int(4.5 * scale)):
            if math.hypot(x - 3.5 * scale, y - 13.0 * scale) <= 1.8 * scale:
                set_pixel(x, y, 255)
        for x in range(int(size - 4.5 * scale), int(size - 1.5 * scale)):
            if math.hypot(x - (size - 3.5 * scale), y - 13.0 * scale) <= 1.8 * scale:
                set_pixel(x, y, 255)

    # 6. Negative space cutouts (eye mask stripes, nose, armpit gaps)
    for y in range(size):
        for x in range(size):
            # Left eye mask
            lmx = x - (cx - 2.2 * scale)
            lmy = y - (7.2 * scale)
            if (lmx / (1.0 * scale)) ** 2 + (lmy / (1.8 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 0)

            # Right eye mask
            rmx = x - (cx + 2.2 * scale)
            rmy = y - (7.2 * scale)
            if (rmx / (1.0 * scale)) ** 2 + (rmy / (1.8 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 0)

            # Nose
            nx = x - cx
            ny = y - (8.8 * scale)
            if (nx / (1.2 * scale)) ** 2 + (ny / (0.8 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 0)

            # Armpit negative space
            if 4.8 * scale <= y <= 7.0 * scale:
                if (cx - 3.8 * scale <= x <= cx - 2.8 * scale) and y < 6.0 * scale:
                    set_pixel(x, y, 0)
                if (cx + 2.8 * scale <= x <= cx + 3.8 * scale) and y < 6.0 * scale:
                    set_pixel(x, y, 0)

    return bytes(pixels)

def draw_app_icon(size: int = 512) -> bytes:
    """Draw a modern rounded app icon badge for macOS with hanging sloth."""
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

    # Draw full hanging sloth in center
    cx = size / 2.0
    scale = size / 36.0

    # Arms
    for y in range(int(10 * scale), int(18 * scale)):
        lx = int(8.0 * scale + (y - 10 * scale) * 0.7)
        for dx in range(int(3.2 * scale)):
            set_pixel(lx + dx, y, 255, 255, 255, 255)
        rx = int(size - 9.0 * scale - (y - 10 * scale) * 0.7)
        for dx in range(int(3.2 * scale)):
            set_pixel(rx - dx, y, 255, 255, 255, 255)

    # Claws at top
    for x in range(int(7.0 * scale), int(12.5 * scale)):
        for y in range(int(8.0 * scale), int(11.0 * scale)):
            set_pixel(x, y, 255, 255, 255, 255)
    for x in range(int(size - 12.5 * scale), int(size - 7.0 * scale)):
        for y in range(int(8.0 * scale), int(11.0 * scale)):
            set_pixel(x, y, 255, 255, 255, 255)

    # Head
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / (6.8 * scale)
            dy = (y - 19.5 * scale) / (5.8 * scale)
            if dx * dx + dy * dy <= 1.0:
                set_pixel(x, y, 255, 255, 255, 255)

    # Body
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / (8.2 * scale)
            dy = (y - 26.5 * scale) / (6.0 * scale)
            if dx * dx + dy * dy <= 1.0:
                set_pixel(x, y, 255, 255, 255, 255)

    # Feet
    for y in range(int(24 * scale), int(29 * scale)):
        for x in range(int(7 * scale), int(11 * scale)):
            if math.hypot(x - 9.5 * scale, y - 26.5 * scale) <= 2.6 * scale:
                set_pixel(x, y, 255, 255, 255, 255)
        for x in range(int(size - 11 * scale), int(size - 7 * scale)):
            if math.hypot(x - (size - 9.5 * scale), y - 26.5 * scale) <= 2.6 * scale:
                set_pixel(x, y, 255, 255, 255, 255)

    # Sloth eye patches (dark blue-slate)
    for y in range(size):
        for x in range(size):
            lmx = x - (cx - 3.4 * scale)
            lmy = y - (19.2 * scale)
            if (lmx / (1.5 * scale)) ** 2 + (lmy / (2.6 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 15, 23, 42, 255)

            rmx = x - (cx + 3.4 * scale)
            rmy = y - (19.2 * scale)
            if (rmx / (1.5 * scale)) ** 2 + (rmy / (2.6 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 15, 23, 42, 255)

            nx = x - cx
            ny = y - (21.5 * scale)
            if (nx / (1.8 * scale)) ** 2 + (ny / (1.2 * scale)) ** 2 <= 1.0:
                set_pixel(x, y, 15, 23, 42, 255)

    return bytes(pixels)

def main():
    assets_dir = Path(__file__).parent / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # 18x18 full hanging sloth trayTemplate.png
    png18 = create_png(18, 18, draw_hanging_sloth_template(18))
    (assets_dir / "trayTemplate.png").write_bytes(png18)

    # 36x36 full hanging sloth trayTemplate@2x.png (Retina display)
    png36 = create_png(36, 36, draw_hanging_sloth_template(36))
    (assets_dir / "trayTemplate@2x.png").write_bytes(png36)

    # 512x512 app icon
    png512 = create_png(512, 512, draw_app_icon(512))
    (assets_dir / "icon.png").write_bytes(png512)

    print("Generated full hanging sloth trayTemplate.png (18x18), trayTemplate@2x.png (36x36), and icon.png successfully.")

if __name__ == "__main__":
    main()
