"""Filesystem names shared with the standalone reader; no database or AI imports."""
import os
import re
from pathlib import Path

PUBLICATION_ID = re.compile(r"pub_[a-f0-9]{32}")
ASSET_NAME = re.compile(r"[a-f0-9]{64}\.png")
PUBLIC_FILES = {"index.html", "project.json", "player.js", "player.css"}


def publication_directory() -> Path:
    return Path(os.environ.get("PUBLICATION_DIR", Path(__file__).parent.parent / "data" / "publications"))
