"""Independent 4x visual and widget-value verifier for local generated PDF files."""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
from zipfile import ZipFile

import fitz


SCALE = fitz.Matrix(4, 4)
CHANNELS = 3
TEXT_LAYER = re.compile(rb"/Tx BMC\r?\n.*?(?=\r?\nQ(?:\r?\n|$))", re.S)
COVER_SPAN = re.compile(rb"/Span << /ActualText <([0-9A-F]+)> >> BDC\n(.*?)\nEMC", re.S)
DARK_PIXELS = bytes(1 if value < 128 else 0 for value in range(256))


def render(page):
    pix = page.get_pixmap(matrix=SCALE, colorspace=fitz.csRGB, alpha=False, annots=True)
    return pix.width, pix.height, pix.samples


def assert_same_outside(before, after, boxes, label):
    width, height, old = before
    assert (width, height) == after[:2], label
    new = after[2]
    for y in range(height):
        left_end = 0
        row = y * width * CHANNELS
        for left, _, right, _ in sorted(box for box in boxes if box[1] <= y < box[3]):
            if left > left_end:
                start, end = row + left_end * CHANNELS, row + left * CHANNELS
                assert old[start:end] == new[start:end], f"{label}: changed pixels outside mapped rects, y={y}"
            left_end = max(left_end, right)
        start, end = row + left_end * CHANNELS, row + width * CHANNELS
        assert old[start:end] == new[start:end], f"{label}: changed pixels outside mapped rects, y={y}"


def ink_bounds(blank, filled, box):
    width = filled[0]
    old, new = blank[2], filled[2]
    left, top, right, bottom = box
    output = [right, bottom, left, top]
    amount = 0
    for y in range(top, bottom):
        start = (y * width + left) * CHANNELS
        end = (y * width + right) * CHANNELS
        if old[start:end] == new[start:end]:
            continue
        for x in range(left, right):
            index = (y * width + x) * CHANNELS
            if old[index:index + CHANNELS] != new[index:index + CHANNELS]:
                output = [min(output[0], x), min(output[1], y), max(output[2], x + 1), max(output[3], y + 1)]
                amount += 1
    return output, amount


def appearance_xref(document, widget):
    kind, raw = document.xref_get_key(widget.xref, "AP/N")
    assert kind == "xref", f"{widget.field_name}: no normal appearance reference"
    return int(raw.split()[0])


def check_alignment(spec, document, widget, page, bounds, box, label):
    kind, value = document.xref_get_key(widget.xref, "MK/R")
    widget_rotation = int(value) if kind == "int" else 0
    direction = (page.rotation - widget_rotation) % 360
    axis = 1 if direction % 180 else 0
    start, end = bounds[axis] - box[axis], box[axis + 2] - bounds[axis + 2]
    if direction >= 180:
        start, end = end, start
    if spec["anchor"] == "center":
        assert abs(start - end) <= 3, (label, widget.field_name, start, end)
    else:
        near, far = (start, end) if spec["anchor"] == "ltr" else (end, start)
        if spec["mode"] == "auto":
            assert near + 10 < far, (label, widget.field_name, start, end)
        else:
            kind, raw_width = document.xref_get_key(widget.xref, "BS/W")
            if kind in ("int", "float"):
                border_width = float(raw_width)
            else:
                kind, border = document.xref_get_key(widget.xref, "Border")
                parts = border.strip("[] ").split(maxsplit=3) if kind == "array" else []
                border_width = float(parts[2]) if len(parts) >= 3 else 0
            expected = 4 * (1.6 + max(0, border_width))
            assert abs(near - expected) <= 3 and near + 10 < far, (label, widget.field_name, near, expected, far)
    return {"alignmentMode": spec["mode"], "alignmentAnchor": spec["anchor"], "logicalHorizontalInsetsAt4x": [start, end]}


def check_case(case, directory):
    before_path, after_path = (directory / case[key] for key in ("before", "after"))
    expected = case["values"]
    checkboxes = case.get("checkboxes", {})
    dropdowns = case.get("dropdowns", {})
    radios = case.get("radios", {})
    alignments = case.get("alignments", {})
    label = case.get("label", after_path.name)
    seen = Counter()
    results = []
    if case.get("customFont"):
        fitz.TOOLS.mupdf_warnings(reset=True)
    with fitz.open(before_path) as original, fitz.open(after_path) as filled, fitz.open(after_path) as no_text:
        assert len(original) == len(filled), label
        edited = set()
        for page in filled:
            for widget in page.widgets():
                if widget.field_name not in expected or widget.field_name in checkboxes or widget.field_name in radios:
                    continue
                xref = appearance_xref(filled, widget)
                if xref in edited:
                    continue
                contents = filled.xref_stream(xref)
                clean, replacement_count = TEXT_LAYER.subn(b"", contents, count=1)
                assert replacement_count == 1, f"{label}: {widget.field_name} has no separable text appearance"
                no_text.update_stream(xref, clean)
                edited.add(xref)
        # Reopen to ensure MuPDF renders the updated streams, independent of any appearance cache.
        with fitz.open(stream=no_text.tobytes()) as blank:
            for page in filled:
                before = render(original[page.number])
                after = render(page)
                text_only_baseline = render(blank[page.number])
                originals = list(original[page.number].widgets())
                new_widgets = list(page.widgets())
                assert len(originals) == len(new_widgets), label
                allowed = []
                for old_widget, widget in zip(originals, new_widgets):
                    field = widget.field_name
                    assert old_widget.field_name == field and old_widget.rect == widget.rect, label
                    if field not in expected:
                        assert widget.field_value == old_widget.field_value, f"{label}: unmapped {field} /V changed"
                        for key in ("V", "AS", "AP"):
                            assert filled.xref_get_key(widget.xref, key) == original.xref_get_key(old_widget.xref, key), (
                                f"{label}: unmapped {field} /{key} changed"
                            )
                        continue
                    seen[field] += 1
                    mapped = (widget.rect * page.rotation_matrix * SCALE).irect
                    box = (max(0, mapped.x0), max(0, mapped.y0), min(after[0], mapped.x1), min(after[1], mapped.y1))
                    assert box[2] > box[0] and box[3] > box[1], (label, field, box)
                    allowed.append(box)
                    if field in checkboxes or field in radios:
                        state = checkboxes[field] if field in checkboxes else radios[field]["widgets"][seen[field] - 1]
                        assert filled.xref_get_key(widget.xref, "AS") == ("name", f"/{state}"), (label, field, "invalid /AS")
                        assert filled.xref_get_key(widget.xref, "AP") == original.xref_get_key(old_widget.xref, "AP"), (
                            f"{label}: button {field} /AP changed"
                        )
                        bounds, amount = ink_bounds(before, after, box)
                        inset = min(bounds[0] - box[0], bounds[1] - box[1], box[2] - bounds[2], box[3] - bounds[3]) if amount else None
                        if filled.xref_get_key(widget.xref, "AS") != original.xref_get_key(old_widget.xref, "AS"):
                            assert amount and inset >= 3, (label, field, "button state changed without visible inset ink", box)
                        state_key = "checkboxState" if field in checkboxes else "radioState"
                        results.append({"field": field, "page": page.number + 1, state_key: state,
                                        "inkBboxAt4x": bounds if amount else None, "inkPixelsAt4x": amount, "minWidgetEdgeInsetAt4x": inset})
                        continue
                    assert (widget.field_value or "") == expected[field], (label, field, widget.field_value, expected[field])
                    bounds, amount = ink_bounds(text_only_baseline, after, box)
                    display = dropdowns.get(field, {}).get("label", expected[field])
                    if display.strip():
                        assert amount, f"{label}: {field} has no visible ink"
                        inset = min(bounds[0] - box[0], bounds[1] - box[1], box[2] - bounds[2], box[3] - bounds[3])
                        assert inset >= 3, (label, field, ink_bounds(text_only_baseline, after, box), box)
                    else:
                        assert not amount, f"{label}: blank {field} has visible ink"
                        inset = None
                    measured_alignment = check_alignment(alignments[field], filled, widget, page, bounds, box, label) if field in alignments else {}
                    results.append({"field": field, "page": page.number + 1, "inkBboxAt4x": bounds if amount else None,
                                    "inkPixelsAt4x": amount, "minWidgetEdgeInsetAt4x": inset, **measured_alignment,
                                    **({"dropdownLabel": display} if field in dropdowns else {})})
                assert_same_outside(before, after, allowed, f"{label} page {page.number + 1}")
                assert_same_outside(text_only_baseline, after, allowed, f"{label} text on page {page.number + 1}")
    assert set(seen) == set(expected), (label, seen, list(expected))
    if case.get("customFont"):
        warnings = fitz.TOOLS.mupdf_warnings(reset=True)
        assert not warnings, f"{label}: MuPDF emitted font or appearance warnings: {warnings}"
    return {"label": label, "outsideMappedWidgetChangedPixels": 0, "clippedInkPixels": 0, "widgets": results}


def check_merged(spec, directory):
    with fitz.open(directory / spec["pdf"]) as merged:
        index = 0
        for row in spec["rows"]:
            with fitz.open(directory / row) as one:
                for source_page in one:
                    output_page = merged[index]
                    assert not list(output_page.widgets()), f"merged page {index + 1} still has widgets"
                    assert render(source_page) == render(output_page), f"merged page {index + 1} differs from {row} page {source_page.number + 1}"
                    index += 1
        assert index == len(merged), "merged page count differs from the individual PDFs"
    return index


def check_cover_ink(page):
    width, height, samples = render(page)
    reds = samples[::CHANNELS]
    dark = reds.translate(DARK_PIXELS)
    margin = 39 * 4
    white = b"\xff" * margin
    assert reds[:width * margin] == reds[-width * margin:] == b"\xff" * (width * margin), (
        f"cover page {page.number + 1}: ink crossed the top or bottom margin"
    )
    bounds = [width, height, 0, 0]
    amount = 0
    for y in range(margin, height - margin):
        start = y * width
        assert reds[start:start + margin] == reds[start + width - margin:start + width] == white, (
            f"cover page {page.number + 1}: ink crossed a side margin"
        )
        row = dark[start:start + width]
        if b"\x01" not in row:
            continue
        amount += row.count(b"\x01")
        bounds = [min(bounds[0], row.index(b"\x01")), min(bounds[1], y),
                  max(bounds[2], row.rindex(b"\x01") + 1), max(bounds[3], y + 1)]
    assert amount > 1_000, f"cover page {page.number + 1}: missing text ink at 4x"
    inset = min(bounds[0], bounds[1], width - bounds[2], height - bounds[3])
    return {"page": page.number + 1, "inkBboxAt4x": bounds, "inkPixelsAt4x": amount, "minPageEdgeInsetAt4x": inset}


def check_covered_merge(spec, directory):
    cover_pages = spec["coverPages"]
    expected = spec["expectedText"]
    fitz.TOOLS.mupdf_warnings(reset=True)
    with fitz.open(directory / spec["pdf"]) as merged, fitz.open(directory / spec["plainPdf"]) as plain:
        assert len(merged) == len(plain) + cover_pages
        ink = []
        index_rows = []
        for page_number in range(cover_pages):
            page = merged[page_number]
            assert abs(page.rect.width - 595.28) < 0.01 and abs(page.rect.height - 841.89) < 0.01
            assert not list(page.widgets()) and not page.get_images(), "cover must be printable vector text"
            spans = [(bytes.fromhex(value.decode("ascii")).decode("utf-16"), operators)
                     for value, operators in COVER_SPAN.findall(page.read_contents())]
            header = [expected["title"], *(expected["details"] if page_number == 0 else []), *expected["headings"]]
            assert [text for text, _ in spans[:len(header)]] == header, (spec["pdf"], page_number, spans[:len(header)])
            assert all(b" Tj" in operators for _, operators in spans), f"{spec['pdf']}: cover text span has no glyphs"
            cells = spans[len(header):]
            assert len(cells) % 4 == 0, f"{spec['pdf']}: incomplete cover table"
            for offset in range(0, len(cells), 4):
                ordinal, row_number, filename, pages = cells[offset:offset + 4]
                if filename[0] in expected["wrappedFilenames"]:
                    assert filename[1].count(b"BT\n") > 1, f"{spec['pdf']}: expected filename to wrap"
                index_rows.append((ordinal[0], row_number[0], filename[0], pages[0]))
            ink.append(check_cover_ink(page))
        index = 0
        expected_index = []
        for ordinal, (row, filename, row_number) in enumerate(zip(spec["rows"], expected["filenames"], expected["rowNumbers"], strict=True), 1):
            with fitz.open(directory / row) as original:
                start, end = index + cover_pages + 1, index + cover_pages + len(original)
                pages = str(start) if start == end else f"{start}–{end}"
                expected_index.append((str(ordinal), str(row_number), filename, pages))
                for source_page in original:
                    page = merged[index + cover_pages]
                    assert not list(page.widgets()), f"{spec['pdf']}: index target page {page.number + 1} still has widgets"
                    image = render(page)
                    assert image == render(source_page), f"{spec['pdf']}: page {page.number + 1} differs from {row}"
                    assert image == render(plain[index]), f"{spec['pdf']}: prepending the cover changed page {index + 1}"
                    index += 1
        assert index_rows == expected_index, f"{spec['pdf']}: displayed cover index differs from actual row pages"
        assert index == len(plain)
    warnings = fitz.TOOLS.mupdf_warnings(reset=True)
    assert not warnings, f"{spec['pdf']}: MuPDF emitted warnings: {warnings}"
    return {"pdf": spec["pdf"], "coverPages": ink, "verifiedIndexRows": len(index_rows),
            "clippedCoverInkPixels": 0, "rowPagesPixelIdentical": index}


def check_zip(spec, directory):
    pages = 0
    with ZipFile(directory / spec["editable"]) as editable, ZipFile(directory / spec["flattened"]) as flattened:
        assert editable.namelist() == flattened.namelist() == spec["rows"]
        for name in spec["rows"]:
            original = editable.read(name)
            assert original == (directory / name).read_bytes(), f"editable ZIP changed {name}"
            with fitz.open(stream=original) as row, fitz.open(stream=flattened.read(name)) as flat:
                assert len(row) == len(flat), f"flattened member {name} lost a page"
                assert flat.xref_get_key(flat.pdf_catalog(), "AcroForm")[0] == "null", f"{name} still has an AcroForm"
                for old_page, flat_page in zip(row, flat):
                    assert not list(flat_page.widgets()), f"{name} page {flat_page.number + 1} still has widgets"
                    assert len(flat_page.get_images()) == len(old_page.get_images()), f"{name} acquired a raster image"
                    assert render(old_page) == render(flat_page), f"{name} page {flat_page.number + 1} differs at 4x"
                    pages += 1
    return pages


def check_watermark(spec, directory):
    fitz.TOOLS.mupdf_warnings(reset=True)
    with fitz.open(directory / spec["plainPdf"]) as plain, fitz.open(directory / spec["pdf"]) as stamped:
        assert len(plain) == len(stamped), spec["label"]
        pages = []
        for old, new in zip(plain, stamped, strict=True):
            assert old.rect == new.rect and old.rotation == new.rotation, spec["label"]
            assert not list(new.widgets()) and new.get_images() == old.get_images(), spec["label"]
            spans = [(bytes.fromhex(value.decode("ascii")).decode("utf-16"), operators)
                     for value, operators in COVER_SPAN.findall(new.read_contents())]
            assert len(spans) == 1 and spans[0][0] == spec["text"], (spec["label"], spans)
            assert b"<0000> Tj" not in spans[0][1] and b" Tj" in spans[0][1], spec["label"]
            traces = [span for span in new.get_texttrace() if abs(span["opacity"] - spec["opacity"]) < 0.005]
            assert traces, f"{spec['label']}: no visible stamp glyph traces"
            for span in traces:
                direction = fitz.Point(*span["dir"]) * new.rotation_matrix - fitz.Point(0, 0) * new.rotation_matrix
                assert abs(math.degrees(math.atan2(-direction.y, direction.x)) - spec["angle"]) < 0.1, (
                    spec["label"], new.rotation, span["dir"], direction, spec["angle"]
                )
                assert all(char[1] > 0 for char in span["chars"]), spec["label"]
            before, after = render(old), render(new)
            width, height = after[:2]
            bounds, amount = ink_bounds(before, after, (0, 0, width, height))
            inset = min(bounds[0], bounds[1], width - bounds[2], height - bounds[3])
            assert amount > 1_000 and inset >= 16, (spec["label"], bounds, amount, inset)
            # Actual templates can use near-black instead of exact black.
            # A black translucent stamp must not brighten any dark RGB pixel.
            old_rgb, new_rgb = before[2], after[2]
            old_ink = 0
            for pixel, red in enumerate(old_rgb[::CHANNELS]):
                if red >= 64:
                    continue
                offset = pixel * CHANNELS
                if old_rgb[offset + 1] >= 64 or old_rgb[offset + 2] >= 64:
                    continue
                old_ink += 1
                assert all(new_rgb[offset + channel] <= old_rgb[offset + channel] for channel in range(CHANNELS)), spec["label"]
            assert old_ink > 10, spec["label"]
            pages.append({"page": new.number + 1, "rotation": new.rotation, "inkBboxAt4x": bounds,
                          "inkPixelsAt4x": amount, "minPageEdgeInsetAt4x": inset, "originalDarkPixelsPreserved": old_ink})
        if "zip" in spec:
            with ZipFile(directory / spec["zip"]) as archive:
                assert archive.namelist() == [spec["member"]], spec["label"]
                with fitz.open(stream=archive.read(spec["member"])) as flattened:
                    assert len(flattened) == len(stamped), spec["label"]
                    assert all(render(first) == render(second) for first, second in zip(flattened, stamped, strict=True)), spec["label"]
    warnings = fitz.TOOLS.mupdf_warnings(reset=True)
    assert not warnings, f"{spec['label']}: MuPDF warnings: {warnings}"
    return {"label": spec["label"], "pdf": spec["pdf"], "clippedWatermarkInkPixels": 0, "pages": pages}


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("manifest", nargs="?", type=Path, default=Path("test-results/pdf-pixels/manifest.json"))
    path = arguments.parse_args().manifest.resolve()
    manifest = json.loads(path.read_text(encoding="utf-8-sig"))
    assert manifest["cases"], "the pixel verification manifest has no cases"
    for filename in {case["before"] for case in manifest["cases"]}:
        source = path.parent / filename
        if re.fullmatch(r"source-[0-9a-f]{64}\.pdf", source.name):
            sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
            assert source.name == f"source-{sha256}.pdf", f"source snapshot hash changed: {filename}"
    results = [check_case(case, path.parent) for case in manifest["cases"]]
    merged = sum(check_merged(manifest[key], path.parent) for key in ("merged", "mixedMerged", "m4Merged") if manifest.get(key))
    covered = [check_covered_merge(spec, path.parent) for spec in manifest.get("coveredMerged", [])]
    zipped = check_zip(manifest["choiceZip"], path.parent) if manifest.get("choiceZip") else 0
    watermarks = [check_watermark(spec, path.parent) for spec in manifest.get("watermarkProofs", [])]
    inks = [item["minWidgetEdgeInsetAt4x"] for result in results for item in result["widgets"] if item["minWidgetEdgeInsetAt4x"] is not None]
    summary = {
        "engine": f"PyMuPDF {fitz.__version__}", "scale": 4, "cases": results, "mergedPagesPixelIdentical": merged,
        "flattenedZipPagesPixelIdentical": zipped,
        "coveredMerged": covered, "watermarkProofs": watermarks,
        "minWidgetEdgeInsetAt4x": min(inks) if inks else None,
        "leadingZeros": manifest.get("leadingZeros", {}), "m2Templates": manifest.get("m2Templates", []),
        "publicTemplates": manifest.get("publicTemplates", []),
    }
    path.with_name(f"{path.stem}-verification.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{summary['engine']}: {len(results)} fills, {len(inks)} ink-bearing widgets, 0 clipped ink pixels, 0 changed pixels outside mapped widgets, {merged} identical merged pages, {zipped} identical flattened ZIP pages.")
    if covered:
        cover_pages = sum(len(item["coverPages"]) for item in covered)
        row_pages = sum(item["rowPagesPixelIdentical"] for item in covered)
        verified_rows = sum(item["verifiedIndexRows"] for item in covered)
        print(f"Cover exports: {cover_pages} covers with 0 clipped pixels, {verified_rows} exact index rows, {row_pages} identical form pages with and without a cover.")
    if watermarks:
        pages = sum(len(proof["pages"]) for proof in watermarks)
        print(f"Watermarks: {pages} stamped pages with visible ink, 0 clipped pixels, and original dark ink preserved.")


if __name__ == "__main__":
    main()
