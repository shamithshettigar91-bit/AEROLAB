#!/usr/bin/env python3
"""Build AeroLab into one self-contained index.html.
Usage (from the project root):  python3 tools/build.py
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "src"
template = (src / "template.html").read_text(encoding="utf-8")
core = (src / "core.js").read_text(encoding="utf-8")
ui = (src / "ui.js").read_text(encoding="utf-8")

# The Node export line is only needed for the tests.
core = "\n".join(l for l in core.splitlines() if "module.exports" not in l)

out = template.replace("/*__CORE__*/", core).replace("/*__UI__*/", ui)
(root / "index.html").write_text(out, encoding="utf-8")
print(f"Built index.html ({len(out):,} bytes)")
