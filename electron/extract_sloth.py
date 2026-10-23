import zlib
import struct
from pathlib import Path

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    idx = 8
    width = height = 0
    idat = bytearray()
    while idx < len(data):
        length = struct.unpack('>I', data[idx:idx+4])[0]
        tag = data[idx+4:idx+8]
        chunk_data = data[idx+8:idx+8+length]
        if tag == b'IHDR':
            width, height = struct.unpack('>II', chunk_data[:8])
        elif tag == b'IDAT':
            idat.extend(chunk_data)
        elif tag == b'IEND':
            break
        idx += 12 + length
    decomp = zlib.decompress(bytes(idat))
    stride = width * 4
    raw = bytearray(width * height * 4)
    decomp_idx = 0
    for y in range(height):
        filter_type = decomp[decomp_idx]
        decomp_idx += 1
        line = bytearray(decomp[decomp_idx : decomp_idx + stride])
        decomp_idx += stride
        if filter_type == 0:
            pass
        elif filter_type == 1:
            for i in range(4, stride):
                line[i] = (line[i] + line[i-4]) & 0xff
        elif filter_type == 2:
            prev = raw[(y-1)*stride : y*stride] if y > 0 else bytearray(stride)
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xff
        elif filter_type == 3:
            prev = raw[(y-1)*stride : y*stride] if y > 0 else bytearray(stride)
            for i in range(stride):
                a = line[i-4] if i >= 4 else 0
                b = prev[i]
                line[i] = (line[i] + ((a + b) >> 1)) & 0xff
        elif filter_type == 4:
            prev = raw[(y-1)*stride : y*stride] if y > 0 else bytearray(stride)
            for i in range(stride):
                a = line[i-4] if i >= 4 else 0
                b = prev[i]
                c = prev[i-4] if i >= 4 else 0
                p = a + b - c
                pa = abs(p - a)
                pb = abs(p - b)
                pc = abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xff
        raw[y*stride : (y+1)*stride] = line
    return width, height, raw

def write_png(width, height, raw_bytes, path):
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    stride = width * 4
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)
        raw_data.extend(raw_bytes[y*stride : (y+1)*stride])
    png += chunk(b'IDAT', zlib.compress(bytes(raw_data), level=9))
    png += chunk(b'IEND', b'')
    Path(path).write_bytes(png)

# Let's see: what makes a pixel part of the background vs sloth?
# Background:
# 1) Very dark outer background: R < 35, G < 35, B < 45
# 2) Blue/Purple squircle: B > 140, B > R + 25 (blue dominant), or high saturation blue/purple
# Sloth and branch:
# Brown / green / cream / tan / black
# None of the sloth pixels have B > R + 25 and B > 130!
# In the sloth:
# Brown fur: R > G > B (R is highest, B is lowest!)
# Branch: G is close to R, B is much lower than G (olive green/brown)
# Cream face: R ~ 240, G ~ 230, B ~ 200 (warm cream, R > B)
# Dark eyes/nose: low R, G, B, but R >= B
DIR = Path(__file__).parent

if __name__ == '__main__':
    w, h, raw = read_png('/Users/kashvi/.gemini/antigravity/brain/26cf2078-b5b8-45d0-9bad-fb41133bb117/.user_uploaded/media_1792797190438_11b11fc7.png')

    sloth_mask = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            idx = (y * w + x) * 4
            r, g, b, a = raw[idx : idx+4]
            
            is_dark_bg = (r < 30 and g < 30 and b < 40)
            is_blue_bg = (b > 115 and (b - r) > 20) or (b > 160 and (b - g) > 20)
            
            if is_dark_bg or is_blue_bg:
                sloth_mask[idx + 3] = 0
            else:
                sloth_mask[idx] = r
                sloth_mask[idx + 1] = g
                sloth_mask[idx + 2] = b
                sloth_mask[idx + 3] = 255

    write_png(w, h, sloth_mask, DIR / 'assets' / 'sloth_extracted.png')
    print("Extracted sloth saved to electron/assets/sloth_extracted.png")
