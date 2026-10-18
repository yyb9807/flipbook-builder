"""SSE serialization used by the legacy durable subscription adapter."""
import json

from sse import _sse


class TestSseSerializer:
    def test_basic_dict(self):
        s = _sse({"step": 1, "pct": 50})
        assert s.startswith("data: ")
        assert s.endswith("\n\n")
        # 把数据部分 parse 出来
        body = s[len("data: ") : -2]
        assert json.loads(body) == {"step": 1, "pct": 50}

    def test_chinese_not_escaped(self):
        s = _sse({"message": "分析中"})
        # ensure_ascii=False，中文应直接出现
        assert "分析中" in s
        assert "\\u" not in s
