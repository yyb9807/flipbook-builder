"""SSE serialization shared by the durable legacy subscription adapter."""
import json


def _sse(data: dict) -> str:
    """Serialize one SSE data message without escaping Chinese text."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
