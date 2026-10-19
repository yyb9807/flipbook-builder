"""Create the original synthetic fixture; no model, downloaded image or fonts.

Run with the repository's backend Python environment. PNG compression bytes can
vary between Pillow/zlib releases; the reviewed dataset freezes its stored PNG.
"""
from pathlib import Path

from PIL import Image, ImageDraw


def generate(path: Path) -> None:
    image = Image.new("RGB", (960, 640), "#faf9f5")
    draw = ImageDraw.Draw(image)
    # Integer, non-overlapping object extents. Bounding boxes include endpoints.
    draw.ellipse((96, 160, 287, 351), fill="#dc4646")
    draw.rectangle((384, 160, 575, 351), fill="#376cc5")
    draw.polygon(((768, 160), (672, 351), (863, 351)), fill="#2a8867")
    image.save(path, format="PNG", optimize=False, compress_level=9)


if __name__ == "__main__":
    generate(Path(__file__).with_name("shapes.png"))
