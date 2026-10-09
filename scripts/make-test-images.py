#!/usr/bin/env python3
"""Generate synthetic test images for the face-e-demo pipeline.

  out/test-e-and-acme.jpg   large standalone "E" + word "ACME"  -> OCR checks pass
  out/test-hello.jpg        word "HELLO" only                   -> E inside word, must NOT count
  out/test-no-text.jpg      plain gradient, no text, no face    -> everything fails

All images are padded with noise so they exceed MIN_UPLOAD_BYTES (40 KB).
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 900
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def noisy_background(w=W, h=H):
    img = Image.new("RGB", (w, h), (245, 245, 245))
    px = img.load()
    random.seed(7)
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            v = random.randint(-8, 8)
            r, g, b = 245 + v, 245 + v, 245 + v
            px[x, y] = (r, g, b)
            if x + 1 < w:
                px[x + 1, y] = (r, g, b)
    return img


def centered(draw, text, y, size, fill=(10, 10, 10)):
    f = font(size)
    bbox = draw.textbbox((0, 0), text, font=f)
    x = (W - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=f, fill=fill)


def save(img, path, quality=92):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "JPEG", quality=quality, optimize=False)
    print(f"{path}  {os.path.getsize(path)} bytes")


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "scripts/out"

    img = noisy_background()
    d = ImageDraw.Draw(img)
    centered(d, "E", 120, 400)
    centered(d, "ACME", 600, 160)
    save(img, os.path.join(out_dir, "test-e-and-acme.jpg"))

    img = noisy_background()
    d = ImageDraw.Draw(img)
    centered(d, "HELLO", 330, 240)
    save(img, os.path.join(out_dir, "test-hello.jpg"))

    img = noisy_background()
    save(img, os.path.join(out_dir, "test-no-text.jpg"))

    # oversized dimensions (> MAX_DIMENSION 1600) -> worker must reject
    big = noisy_background(2200, 1400)
    d = ImageDraw.Draw(big)
    d.text((80, 600), "E", font=font(500), fill=(10, 10, 10))
    save(big, os.path.join(out_dir, "test-oversize.jpg"), quality=70)


if __name__ == "__main__":
    main()
