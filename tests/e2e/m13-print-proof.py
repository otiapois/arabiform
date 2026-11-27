"""Inspect three real Edge downloads. Sample QR modules from physical A4 sheet pixels."""
import json
import math
from pathlib import Path
import runpy
import sys

import fitz


pixels = runpy.run_path(str(Path(__file__).resolve().parents[2] / "scripts/verify-pdf-pixels.py"))
four = fitz.Matrix(4, 4)
filenames = ["00123.pdf", "00007.pdf", "00042.pdf"]


def spans(stream):
    return [bytes.fromhex(text.decode()).decode("utf-16") for text, operators in pixels["COVER_SPAN"].findall(stream)
            if b" Tj" in operators]


def gray(page, matrix=four):
    return page.get_pixmap(matrix=matrix, colorspace=fitz.csGRAY, alpha=False)


def frames(source, page):
    # Evaluate both orientations of the A4 stock and both ways to divide its usable area.
    candidates = []
    for width, height in [(595.28, 841.89), (841.89, 595.28)]:
        for cols, rows in [(1, 2), (2, 1)]:
            cell_w, cell_h = (width - 36 - 18 * (cols - 1)) / cols, (height - 36 - 18 * (rows - 1)) / rows
            scale = min(cell_w / source.width, cell_h / source.height)
            candidates.append((scale, width, height, cols, cell_w, cell_h))
    scale, width, height, cols, cell_w, cell_h = max(candidates)
    assert abs(page.rect.width - width) < .01 and abs(page.rect.height - height) < .01
    w, h = source.width * scale, source.height * scale
    boxes = []
    for slot in range(2):
        x = 18 + (cell_w - w) / 2 + (slot % cols) * (cell_w + 18)
        y = 18 + (cell_h - h) / 2 + (slot // cols) * (cell_h + 18)
        boxes.append(fitz.Rect(x, y, x + w, y + h))
    assert not boxes[0].intersects(boxes[1])
    return scale, boxes


def cut_marks(page, boxes, pix):
    """Require both field-aligned 5 pt strokes at each occupied corner, and no others."""
    seen = []
    for path in page.get_drawings():
        if path["type"] == "s" and abs(path["width"] - .35) < .001:
            seen.extend((a, b) for tag, a, b in path["items"] if tag == "l")
    assert len(seen) == len(boxes) * 8
    allowed = [(box * four).irect + (-1, -1, 1, 1) for box in boxes]
    samples = pix.samples
    for box in boxes:
        for x, dx in [(box.x0, -1), (box.x1, 1)]:
            for y, dy in [(box.y0, -1), (box.y1, 1)]:
                for vx, vy in [(dx, 0), (0, dy)]:
                    near, far = fitz.Point(x + 2 * vx, y + 2 * vy), fitz.Point(x + 7 * vx, y + 7 * vy)
                    item = next((ab for ab in seen if min(max(a.distance_to(near), b.distance_to(far))
                                for a, b in (ab, ab[::-1])) < .02), None)
                    assert item is not None, (box, near, far)
                    seen.remove(item)
                    rect = (fitz.Rect(near, far).normalize() * four).irect + (-2, -2, 2, 2)
                    assert not any((record * four).intersects(rect) for record in boxes)
                    assert any(min(samples[yy * pix.width + rect.x0:yy * pix.width + rect.x1]) < 200
                               for yy in range(rect.y0, rect.y1))
                    allowed.append(rect)
    for y in range(pix.height):
        # Outside the slots and their cut strokes, the entire physical page must be white.
        row = samples[y * pix.width:(y + 1) * pix.width]
        left = 0
        for rect in sorted((r for r in allowed if r.y0 <= y < r.y1), key=lambda r: r.x0):
            assert not row[left:rect.x0].strip(b"\xff"), (y, left, rect.x0)
            left = max(left, rect.x1)
        assert not row[left:].strip(b"\xff"), (y, left)
    return 8 * len(boxes)


def compare_source_and_watermark(original, printed, plain, box, scale):
    # Render the original visible CropBox with its actual rotation at the imposed scale and
    # origin, so its ink can be directly compared to the same physical coordinates on the sheet.
    matrix = fitz.Matrix(4 * scale, 4 * scale) * fitz.Matrix(1, 0, 0, 1, 4 * box.x0, 4 * box.y0)
    ref = gray(original, matrix)
    expected, actual, unmarked = ref.samples, printed.samples, plain.samples
    dark_refs = dark_actual = missing = unexpected = changed = 0
    for y in range(3, ref.height - 3, 3):
        for x in range(3, ref.width - 3, 3):
            i = y * ref.width + x
            j = (y + ref.y) * printed.width + x + ref.x
            if expected[i] < 160:
                dark_refs += 1
                if actual[j] >= 205:
                    missing += all(actual[j + dy * printed.width + dx] >= 205 for dy in (-2, 0, 2) for dx in (-2, 0, 2))
            if actual[j] < 160:
                dark_actual += 1
                if expected[i] >= 205:
                    unexpected += all(expected[i + dy * ref.width + dx] >= 205 for dy in (-2, 0, 2) for dx in (-2, 0, 2))
            if x < .80 * ref.width and .15 * ref.height < y < .85 * ref.height:
                changed += unmarked[j] - actual[j] >= 8
    assert min(dark_refs, dark_actual) > 500 and changed > 100
    assert missing / dark_refs < .005 and unexpected / dark_actual < .005, (missing, dark_refs, unexpected, dark_actual)
    return {"sampledSourceInk": dark_refs, "sampledPrintInk": dark_actual, "missing": missing,
            "unexpected": unexpected, "watermarkDarkenedSamples": changed}


def qr_modules(image, box, scale):
    samples = image.samples
    # v1 (21 by 21) is the contract for the short CERT ID, plus four quiet modules per side.
    step = scale * 48 / 29
    x0, y0 = box.x1 - 57 * scale, box.y1 - 57 * scale
    grid = []
    for y in range(29):
        row = []
        for x in range(29):
            sample = samples[math.floor(4 * (y0 + (y + .5) * step)) * image.width + math.floor(4 * (x0 + (x + .5) * step))]
            assert sample <= 30 or sample >= 225, (x, y, sample)
            if min(x, y, 28 - x, 28 - y) < 4:
                assert sample >= 250, "QR quiet zone contaminated"
            row.append(sample < 128)
        grid.append(row)
    return [row[4:-4] for row in grid[4:-4]]


def main(printed_path, reference_path, plain_path):
    with fitz.open(printed_path) as printed, fitz.open(reference_path) as original, fitz.open(plain_path) as plain:
        assert len(printed) == len(plain) == len(original) == 3
        assert gray(printed[0]).digest == gray(plain[0]).digest, "Watermark or QR changed the bilingual cover"
        cover = spans(printed[0].read_contents())
        index = cover[cover.index("#"):]
        assert index == ["#", "Row", "Filename", "Sheets", "الصف", "اسم الملف", "الأوراق",
                         "1", "1", filenames[0], "2", "2", "2", filenames[1], "2", "3", "3", filenames[2], "3"], index
        result = {"scale": 4, "coverIndex": index[7:], "coverPanelInk": pixels["check_bilingual_panel_ink"](printed[0]),
                  "identicalCoverRaster": True, "sheets": [], "rows": []}
        for sheet_number, count in [(2, 2), (3, 1)]:
            page = printed[sheet_number - 1]
            first = 2 * (sheet_number - 2)
            assert not page.get_images() and not list(page.widgets()) and page.rotation == 0
            objects = [xref for xref, _, parent, _ in page.get_xobjects() if parent == 0]
            assert len(objects) == count
            scale, boxes = frames(original[first].rect, page)
            ink, before = gray(page), gray(plain[sheet_number - 1])
            marks = cut_marks(page, boxes[:count], ink)
            result["sheets"].append({"physicalPage": sheet_number, "sizePt": list(page.rect)[2:], "cutMarks": marks,
                                     "outsideInk": 0, "overlappingRecords": 0})
            for slot in range(count):
                source = original[first + slot]
                assert source.rotation == 90 and source.cropbox != source.mediabox
                assert "مسودة" in spans(printed.xref_stream(objects[slot]))
                box = boxes[slot]
                comparison = compare_source_and_watermark(source, ink, before, box, scale)
                result["rows"].append({"row": first + slot + 1, "sheet": sheet_number, "framePt": list(box),
                                       "scale": scale, "comparison": comparison, "modules": qr_modules(ink, box, scale)})
        return result


if __name__ == "__main__":
    print(json.dumps(main(*sys.argv[1:]), indent=2))
