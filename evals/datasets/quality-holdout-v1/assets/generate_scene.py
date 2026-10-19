"""Original deterministic scene. No model, font, network, or third-party art.

Pixel bounds use Pillow's half-open getbbox convention. Labels are calculated
after compositing, so hidden pixels never expand an annotation. Running this
script regenerates scene.png, scene.svg, and geometry.json in this directory.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = (1000, 700)
BACKGROUND = "#F4F0E7"
LAYERS = (
    ("purple-ring", "#8054B5", "ring", (60, 70, 270, 280)),
    ("orange-capsule", "#ECA23B", "capsule", (770, 65, 880, 330)),
    ("blue-quadrilateral", "#2B7DAA", "polygon", ((290, 340), (520, 190), (700, 440), (445, 615))),
    ("green-star", "#4F9C77", "polygon", ((892, 480), (910, 522), (957, 526), (921, 557), (932, 605), (892, 580), (850, 605), (862, 557), (826, 526), (874, 522))),
    ("coral-bar", "#E86C58", "rectangle", (95, 385, 415, 470)),
)


def build_scene():
    image = Image.new("RGB", SIZE, BACKGROUND)
    owner = Image.new("L", SIZE, 0)
    masks = {}
    svg_parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700">', f'<rect width="1000" height="700" fill="{BACKGROUND}"/>']
    for index, (name, color, kind, points) in enumerate(LAYERS, start=1):
        mask = Image.new("L", SIZE, 0)
        draw = ImageDraw.Draw(mask)
        if kind == "ring":
            draw.ellipse(points, fill=255)
            draw.ellipse((112, 122, 218, 228), fill=0)
            svg_parts.append(f'<path fill="{color}" fill-rule="evenodd" d="M 270.5 175.5 A 105.5 105.5 0 1 0 59.5 175.5 A 105.5 105.5 0 1 0 270.5 175.5 Z M 218.5 175.5 A 53.5 53.5 0 1 1 111.5 175.5 A 53.5 53.5 0 1 1 218.5 175.5 Z"/>')
        elif kind == "capsule":
            draw.rounded_rectangle(points, radius=55, fill=255)
            svg_parts.append(f'<rect x="770" y="65" width="111" height="266" rx="55" fill="{color}"/>')
        elif kind == "polygon":
            draw.polygon(points, fill=255)
            svg_parts.append(f'<polygon points="{" ".join(f"{x},{y}" for x, y in points)}" fill="{color}"/>')
        else:
            draw.rectangle(points, fill=255)
            svg_parts.append(f'<rect x="95" y="385" width="321" height="86" fill="{color}"/>')
        masks[name] = (index, mask)
        image.paste(color, (0, 0), mask)
        owner.paste(index, (0, 0), mask)
    records = []
    for name, (index, mask) in masks.items():
        visible = owner.point(lambda value: 255 if value == index else 0, "L")
        x0, y0, x1, y1 = visible.getbbox()
        original_count = sum(mask.histogram()[1:])
        visible_count = sum(visible.histogram()[1:])
        records.append({"id": name, "pixel_box_half_open": [x0, y0, x1, y1], "box": {"x": x0 / SIZE[0], "y": y0 / SIZE[1], "width": (x1 - x0) / SIZE[0], "height": (y1 - y0) / SIZE[1]}, "visible_pixels": visible_count, "occluded_pixels": original_count - visible_count})
    svg_parts.append("</svg>")
    return image, "\n".join(svg_parts) + "\n", records


if __name__ == "__main__":
    directory = Path(__file__).resolve().parent
    image, svg, objects = build_scene()
    image.save(directory / "scene.png", optimize=False)
    (directory / "scene.svg").write_text(svg, encoding="utf-8")
    record = {"schema_version": 1, "width": SIZE[0], "height": SIZE[1], "png_sha256": hashlib.sha256((directory / "scene.png").read_bytes()).hexdigest(), "coordinate_convention": "visible-support pixel bounding boxes, half-open endpoints, normalized by full raster width/height", "objects": objects}
    (directory / "geometry.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
