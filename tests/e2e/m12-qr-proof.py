"""Check the actual Edge PDF and ZIP downloads against sampled SVG geometry at 4×."""
import hashlib
import json
import math
from pathlib import Path
import re
import runpy
import sys
from zipfile import ZipFile

import fitz


suite = runpy.run_path(str(Path(__file__).resolve().parents[2] / "scripts/verify-pdf-pixels.py"))
render = suite["render"]
names = ["00123.pdf", "00007.pdf"]


def cover_proof(page):
    spans = [
        (bytes.fromhex(hex_text.decode()).decode("utf-16"), operators)
        for hex_text, operators in suite["COVER_SPAN"].findall(page.read_contents())
    ]
    assert all(b" Tj" in operators for _, operators in spans)
    text = [value for value, _ in spans]
    expected_index = ["#", "Row", "Filename", "Pages", "الصف", "اسم الملف", "الصفحات",
                      "1", "1", names[0], "2–3", "2", "2", names[1], "4–5"]
    assert text[text.index("#"):] == expected_index, text
    expected = [
        ("ArabiForm · Batch Print Manifest", "ArabiForm · سجل طباعة الدفعة"),
        ("Export date", "تاريخ التصدير"), ("Template", "القالب"),
        ("Ready: 2   ·   Flagged: 0   ·   Skipped: 0", "جاهز: 2   ·   يحتاج إلى مراجعة: 0   ·   تم تخطيه: 0"),
    ]
    half = page.rect.width / 2
    for pair in expected:
        for side, value in enumerate(pair):
            operators = next(ops for label, ops in spans if label == value)
            points = re.findall(rb"1 0 0 1 ([\d.]+) ([\d.]+) Tm", operators)
            assert points and all((float(x) < half) == (side == 0) for x, _ in points), value
    assert not list(page.widgets()) and not page.get_images()
    return {"index": expected_index[7:], "ink": suite["check_cover_ink"](page, None),
            "panelInk": suite["check_bilingual_panel_ink"](page)}


def check_stamp(page, baseline, matrix):
    actual = render(page)
    w, h, colors = actual
    # This fixture has exact integer page dimensions and a nonzero CropBox in both orientations.
    assert tuple(page.cropbox) != tuple(page.mediabox) and page.rotation in (0, 90)
    assert w == page.rect.width * 4 and h == page.rect.height * 4
    side = 48 * 4
    left, top = w - 9 * 4 - side, h - 9 * 4 - side
    box = (left, top, left + side, top + side)
    assert left >= 36 and top >= 36
    assert not list(page.widgets()) and not page.get_images()
    suite["assert_same_outside"](render(baseline), actual, [box], "actual Edge QR")
    total = len(matrix) + 8
    step = side / total
    # At 4× a module edge may intersect one pixel. Require every fully interior sample, not just its center.
    interior = 0
    for row in range(total):
        for col in range(total):
            dark = 4 <= row < total - 4 and 4 <= col < total - 4 and matrix[row - 4][col - 4]
            color = bytes([0 if dark else 255]) * 3
            begin = math.ceil(left + col * step + 0.25)
            end = math.floor(left + (col + 1) * step - 1.25) + 1
            y0 = math.ceil(top + row * step + 0.25)
            y1 = math.floor(top + (row + 1) * step - 1.25) + 1
            assert begin < end and y0 < y1
            for y in range(y0, y1):
                start = (y * w + begin) * 3
                assert colors[start:start + (end - begin) * 3] == color * (end - begin), (row, col)
            interior += (end - begin) * (y1 - y0)
    # Inspect uninterrupted white strips across the seams between quiet-zone cells as well.
    quiet = math.floor(4 * step) - 1
    for dy in range(1, side - 1):
        strips = [(1, side - 1)] if dy <= quiet or dy >= side - quiet else [(1, quiet), (side - quiet, side - 1)]
        for x0, x1 in strips:
            offset = ((top + dy) * w + left + x0) * 3
            assert colors[offset:offset + (x1 - x0) * 3] == bytes([255]) * ((x1 - x0) * 3)
    return {"rotation": page.rotation, "boundsAt4x": box, "gridModules": len(matrix) ** 2,
            "matrixSha256": hashlib.sha256(bytes(bit for row in matrix for bit in row)).hexdigest(),
            "checkedModuleInteriorPixels": interior, "quietZoneModules": 4, "outsideChanges": 0, "clipped": 0}


def main():
    plain_file, marked_file, flat_file, unmarked_file, editable_file, preview = sys.argv[1:]
    matrices = json.loads(Path(preview).read_text(encoding="utf8"))
    assert len(matrices) == 2 and matrices[0] != matrices[1]
    stamps = []
    with fitz.open(plain_file) as plain, fitz.open(marked_file) as marked, ZipFile(flat_file) as flat, \
            ZipFile(unmarked_file) as prior, ZipFile(editable_file) as editable:
        assert len(plain) == len(marked) == 5
        assert flat.namelist() == prior.namelist() == editable.namelist() == names
        assert render(plain[0]) == render(marked[0]), "stamp altered the bilingual cover"
        cover = cover_proof(marked[0])
        for row, name in enumerate(names):
            with fitz.open(stream=flat.read(name), filetype="pdf") as pages, \
                    fitz.open(stream=prior.read(name), filetype="pdf") as before, \
                    fitz.open(stream=editable.read(name), filetype="pdf") as after:
                assert len(pages) == len(before) == len(after) == 2
                for index, zip_page in enumerate(pages):
                    i = 1 + row * 2 + index
                    assert zip_page.rotation == marked[i].rotation == (0 if index == 0 else 90)
                    assert not list(zip_page.widgets()) and not zip_page.get_images()
                    assert render(zip_page) == render(marked[i]), "stamped ZIP/merge rasters differ"
                    assert render(before[index]) == render(after[index]) == render(plain[i]), "editable appearance changed"
                    assert list(after[index].widgets()), "editable page lost its form"
                    stamp = check_stamp(marked[i], plain[i], matrices[row])
                    stamp.update(mergedPage=i + 1, zipMember=name, zipPage=index + 1)
                    stamps.append(stamp)
    print(json.dumps({"scale": 4, "cover": cover, "stamps": stamps, "unchangedEditablePages": 4}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
