"""Explicit image coordinate conversion for the optional focused revision."""
import math

from agents.hotspot_localization import sanitize_hotspots


def bbox_hotspots_to_xywh(raw: object, max_count: int = 12) -> list[dict]:
    """Validate relative 0–1000 xyxy boxes, then use the existing xywh sanitizer.

    Invalid entries are discarded, never repaired. Input objects are untouched;
    decimals retain their stated scale and are never interpreted as 0–1 boxes.
    """
    if not isinstance(raw, list):
        return []
    converted = []
    for hotspot in raw:
        if (not isinstance(hotspot, dict) or not isinstance(hotspot.get("label"), str)
                or not hotspot["label"].strip()
                or any(field in hotspot for field in ("x", "y", "width", "height"))):
            continue
        box = hotspot.get("bbox_2d")
        if not isinstance(box, list) or len(box) != 4:
            continue
        # Range checks precede isfinite so arbitrarily large JSON integers cannot
        # overflow Python's conversion to float inside math.isfinite.
        if any(isinstance(value, bool) or not isinstance(value, (int, float))
               or not 0 <= value <= 1000 or not math.isfinite(value) for value in box):
            continue
        left, top, right, bottom = box
        if left >= right or top >= bottom:
            continue
        score = hotspot.get("score")
        if (isinstance(score, bool) or not isinstance(score, (int, float))
                or not 0 <= score <= 1 or not math.isfinite(score)):
            score = None
        converted.append({
            "label": hotspot["label"], "x": left / 1000, "y": top / 1000,
            "width": (right - left) / 1000, "height": (bottom - top) / 1000,
            "score": score,
        })
    return sanitize_hotspots(converted, max_count)
