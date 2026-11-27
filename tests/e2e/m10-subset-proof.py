"""Read actual Edge downloads, using the same 4× renderer as the standalone pixel sweep."""
import json
from pathlib import Path
import runpy
import sys
from zipfile import ZipFile

import fitz

from_pdf_suite = runpy.run_path(str(Path(__file__).resolve().parents[2] / "scripts/verify-pdf-pixels.py"))
zip_file, merged_file, language = sys.argv[1:]
names = ["packet-2.pdf", "packet-4.pdf"]
headers = ["#", "Row", "Filename", "Pages"] if language == "en" else ["#", "الصف", "اسم الملف", "الصفحات"]
rows = ["1", "2", names[0], "2–3", "2", "4", names[1], "4–5"]
with fitz.open(merged_file) as merged, ZipFile(zip_file) as archive:
    assert len(merged) == 5 and archive.namelist() == names
    spans = from_pdf_suite["COVER_SPAN"].findall(merged[0].read_contents())
    assert all(b" Tj" in operators for _, operators in spans)
    cells = [bytes.fromhex(hex_text.decode("ascii")).decode("utf-16") for hex_text, _ in spans]
    assert cells[cells.index("#"):] == headers + rows, cells
    ink = from_pdf_suite["check_cover_ink"](merged[0], None)
    index_text = merged[0].get_texttrace()[-len(rows):]
    assert ["".join(chr(char[0]) for char in span["chars"]) for span in index_text] == rows
    glyph_ink = []
    for span in index_text:
        for char in span["chars"]:
            bounds = fitz.Rect(char[3])
            pixels = merged[0].get_pixmap(matrix=fitz.Matrix(4, 4), clip=bounds, colorspace=fitz.csGRAY)
            dark = sum(v < 175 for v in pixels.samples)
            assert dark > 0, ("missing cover glyph", chr(char[0]), bounds)
            glyph_ink.append(dark)
    for index, name in enumerate(names):
        with fitz.open(stream=archive.read(name), filetype="pdf") as source:
            assert len(source) == 2
            for page in source:
                dest = merged[1 + 2 * index + page.number]
                assert not list(dest.widgets())
                assert from_pdf_suite["render"](page) == from_pdf_suite["render"](dest), (name, page.number)
print(json.dumps({"cells": rows, "identicalBodyPagesAt4x": 4, "coverInk": ink, "indexGlyphInkAt4x": glyph_ink}, ensure_ascii=False))
