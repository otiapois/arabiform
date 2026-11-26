"""Compare three actual Edge downloads, including the ink of each non-space footer glyph."""
import json
import re
import sys
import pymupdf as fitz


plain_file, unmarked_file, marked_file, template, roster = sys.argv[1:]
expected = f"Template SHA-256 {template[:12]}   ·   Roster SHA-256 {roster[:12]}"
scale = fitz.Matrix(4, 4)


def rendered(page, clip=None):
    return page.get_pixmap(matrix=scale, colorspace=fitz.csGRAY, alpha=False, clip=clip)


with fitz.open(plain_file) as plain, fitz.open(unmarked_file) as unmarked, fitz.open(marked_file) as marked:
    assert len(marked) == len(unmarked) == len(plain) + 1
    for i, body in enumerate(plain):
        images = [rendered(page) for page in (body, unmarked[i + 1], marked[i + 1])]
        assert len({(pix.width, pix.height, pix.digest) for pix in images}) == 1, f"body page {i + 1} changed"
    cover = marked[0]
    marked_text = lambda page: [bytes.fromhex(s.decode()).decode("utf-16") for s in re.findall(rb"/ActualText\s*<([0-9A-Fa-f]+)>", page.read_contents())]
    assert marked_text(cover).count(expected) == 1
    assert expected not in marked_text(unmarked[0])
    chars = [char for trace in cover.get_texttrace() for char in trace["chars"]
             if char[2][1] > cover.rect.height - 90 and not chr(char[0]).isspace()]
    assert "".join(chr(char[0]) for char in chars) == "".join(expected.split())
    ink = []
    for char in chars:
        bounds = fitz.Rect(char[3])
        assert cover.rect.contains(bounds) and min(bounds.x0, bounds.y0, cover.rect.width - bounds.x1, cover.rect.height - bounds.y1) >= 30
        on, off = rendered(cover, bounds), rendered(unmarked[0], bounds)
        dark = sum(sample < 175 for sample in on.samples)
        assert dark > 0 and min(off.samples) == 255, f"missing independent footer ink for {chr(char[0])}"
        ink.append(dark)
    print(json.dumps({"scale": 4, "footer": expected, "nonSpaceGlyphs": len(chars),
                      "darkPixelsPerGlyph": ink, "identicalBodyPages": len(plain)}, indent=2))
