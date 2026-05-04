import json
import random
import re
import string


def gen_id(prefix: str = "") -> str:
    chars = string.ascii_lowercase + string.digits
    suffix = "".join(random.choices(chars, k=10))
    return f"{prefix}{suffix}" if prefix else suffix


def extract_json(text: str) -> dict | list | None:
    text = text.strip()

    # 1. 直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. 提取 markdown 代码块
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 3. 提取第一个 { } 或 [ ] 块
    for pattern in (r"(\{[\s\S]*\})", r"(\[[\s\S]*\])"):
        match = re.search(pattern, text)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

    return None
