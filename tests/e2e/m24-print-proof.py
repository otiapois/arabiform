"""Inspect the actual browser/CLI-delivered bytes with independent PDF and raster engines."""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageChops, ImageDraw


def spans(page):
    marked = re.findall(rb"/Span << /ActualText <([0-9A-F]+)> >> BDC\n(.*?)\nEMC", page.read_contents(), re.S)
    return [bytes.fromhex(value.decode()).decode("utf-16") for value, ops in marked if b" Tj" in ops]


def card_frames(source, page):
    w, h = source.rect.width, source.rect.height
    candidates = [(595.28, 841.89), (841.89, 595.28)]
    scale, width, height = max((min((a-54)/(2*w), (b-54)/(2*h)), a, b) for a, b in candidates)
    assert abs(page.rect.width - width) < .001 and abs(page.rect.height - height) < .001
    frames = []
    for row in range(2):
        for col in range(2):
            cx = width / 4 + 4.5 + col * (width / 2 - 9)
            cy = height / 4 + 4.5 + row * (height / 2 - 9)
            frames.append(fitz.Rect(cx-w*scale/2, cy-h*scale/2, cx+w*scale/2, cy+h*scale/2))
    return frames


def inspect_sheet(source, page, rows, guides):
    frames = card_frames(source, page)
    matrix = fitz.Matrix(4, 4)
    pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csGRAY, alpha=False)
    raster = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    outside = Image.new("L", raster.size, 255)
    mask = ImageDraw.Draw(outside)
    marks = []
    for path in page.get_drawings():
        if path["type"] == "s" and all(item[0] == "l" for item in path["items"]):
            for _, a, b in path["items"]:
                if abs(path["width"] - .35) < .001 or a.distance_to(b) > 500:
                    marks.append((a, b, path["width"]))
    assert not list(page.widgets()) and not page.get_images() and page.rotation == 0
    assert len([x for x in page.get_xobjects() if x[2] == 0]) == sum(row is not None for row in rows)
    used = [box for row, box in zip(rows, frames) if row is not None]

    def check_stroke(a, b, is_center=False):
        for i, (near, far, width) in enumerate(marks):
            if min(max(near.distance_to(v), far.distance_to(w)) for v, w in [(a, b), (b, a)]) < .02:
                break
        else:
            raise AssertionError(("missing stroke", a, b, marks))
        marks.pop(i)
        assert 0 < width < .35 if is_center else abs(width - .35) < .001
        rect = (fitz.Rect(a, b).normalize() * matrix).irect + (-2, -2, 2, 2)
        assert not any((box * matrix).intersects(rect) for box in used)
        assert raster.crop(tuple(rect)).getextrema()[0] < 230, ("unpainted stroke", a, b)
        mask.rectangle(tuple(rect), fill=0)

    for box, row in zip(frames, rows):
        ids = re.findall(r"\b0\d{4}\b", page.get_text("text", clip=box))
        if row is None:
            assert not ids and raster.crop(tuple((box * matrix).irect)).getextrema() == (255, 255)
            continue
        assert ids == [str(row).zfill(5)], (row, ids, box)
        mask.rectangle(tuple((box * matrix).irect + (-1, -1, 1, 1)), fill=0)
        for x, dx in [(box.x0, -1), (box.x1, 1)]:
            for y, dy in [(box.y0, -1), (box.y1, 1)]:
                check_stroke(fitz.Point(x+2*dx, y), fitz.Point(x+7*dx, y))
                check_stroke(fitz.Point(x, y+2*dy), fitz.Point(x, y+7*dy))
    if guides:
        w, h = page.rect.width, page.rect.height
        check_stroke(fitz.Point(w/2, 9), fitz.Point(w/2, h-9), True)
        check_stroke(fitz.Point(9, h/2), fitz.Point(w-9, h/2), True)
    assert not marks, marks
    assert ImageChops.multiply(ImageChops.invert(raster), outside).getbbox() is None
    return {"rowsBySlot": rows, "sizePt": list(page.rect)[2:], "trimStrokes": len(used)*8,
            "centerGuides": 2*int(guides), "unexpectedInkAt4x": 0}


def proof(config):
    directory = Path(config["dir"])
    rows, covers = config["rows"], config["covers"]
    count = math.ceil(len(rows) / 4)
    print_name = "arabiform-merged.pdf"
    files = [(config["templateName"], Path(config["template"])),
             (config["rosterName"], Path(config["roster"])), (print_name, directory / print_name)]
    digests = [hashlib.sha256(path.read_bytes()).hexdigest() for _, path in files]
    with fitz.open(files[0][1]) as source, fitz.open(files[2][1]) as merged, fitz.open(directory/"print-shop-certificate.pdf") as cert:
        assert len(cert) == 1 and len(merged) == count + covers
        words = spans(cert[0])
        for line in ["Print-Shop Preflight Certificate", "شهادة فحص المطبعة", "0 clipped fields verified",
                     "Mapped text ink-fit preflight", "Imposition: 4-up",
                     "Scope: " + config["scope"], f"Ready: {len(rows)}  /  Excluded: {config['total']-len(rows)}",
                     f"Physical sheets: {len(merged)}  /  Cover pages: {covers}"]:
            assert line in words, (line, words)
        assert [s.removeprefix("SHA-256 ") for s in words if s.startswith("SHA-256 ")] == digests
        metadata = json.loads(cert.metadata["subject"])
        for field, (name, _) in zip(["templateName", "rosterName", "outputName"], files):
            assert metadata[field] == name
            if not any(ord(char) > 0x3000 for char in name):
                assert name in words, (name, words)
        embedded = sorted({re.sub(r"^[A-Z]{6}\+", "", name)
                           for page in merged for xref, _, _, name, *_ in page.get_fonts(full=True)
                           if merged.extract_font(xref)[3]})
        assert embedded and all(name in words for name in embedded)
        assert metadata["embeddedFonts"] == embedded
        assert set(words[words.index("Embedded font names")+2:words.index("Minimum rendered mapped text")]) == set(embedded)
        assert all(fitz.Rect(20, 20, cert[0].rect.width-20, cert[0].rect.height-20).contains(fitz.Rect(t["bbox"]))
                   for t in cert[0].get_texttrace() if t["chars"])
        findings, point_sizes = [], []
        for i in range(count):
            page = merged[covers+i]
            positions = [slot*count+i if config["stack"] else 4*i+slot for slot in range(4)]
            findings.append(inspect_sheet(source[0], page, [rows[j] if j < len(rows) else None for j in positions], config["guides"]))
            point_sizes.extend(t["size"] for t in page.get_texttrace() if t["font"] in ("ArabiFormSans", "ArabiFormNaskh") and t["chars"])
        reported = float(next(s[:-3] for s in words if re.fullmatch(r"[\d.]+ pt", s)))
        assert abs(min(point_sizes)-reported) <= .0001, (min(point_sizes), reported)
        if covers:
            index = spans(merged[0])
            first = index.index("Sheets") + 1
            records = index[first:]
            while records and not records[0].isdigit():
                records.pop(0)
            assert len(records) == len(rows)*4, records
            for j, n in enumerate(rows):
                sheet = j % count if config["stack"] else j // 4
                assert records[j*4+1] == str(n) and records[j*4+3] == str(covers+sheet+1), (records, n)
        return {"printSha256": digests[-1], "sourceSha256": digests[:2], "certificateMetadata": metadata,
                "physicalSheets": len(merged), "coverPages": covers, "fontInventory": embedded,
                "minMappedPtInPrint": min(point_sizes), "minCertificatePt": reported, "sheets": findings}


if __name__ == "__main__":
    print(json.dumps(proof(json.load(sys.stdin)), ensure_ascii=True))
