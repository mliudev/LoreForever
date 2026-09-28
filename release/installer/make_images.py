"""Installer artwork from the logo: release/logo.ico (setup icon) and the wizard bitmaps.

Run: uv run --with pillow python release/installer/make_images.py
"""

from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
logo = Image.open(HERE.parent / "logo.png").convert("RGBA")

logo.save(HERE.parent / "logo.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

BG = (14, 14, 28)


def on_bg(size, mark, top):
    img = Image.new("RGB", size, BG)
    m = logo.resize((mark, mark), Image.LANCZOS)
    img.paste(m, ((size[0] - mark) // 2, top), m)
    return img


# Inno picks the closest size for the display's DPI; give it 100%, 150% and 200% versions.
for scale, suffix in ((1, ""), (1.5, "-150"), (2, "-200")):
    s = int(55 * scale)
    on_bg((s, s), s, 0).save(HERE / f"wizard-small{suffix}.bmp")
    on_bg((int(164 * scale), int(314 * scale)), int(140 * scale), int(60 * scale)).save(HERE / f"wizard-large{suffix}.bmp")
print("wrote logo.ico and wizard bitmaps")
