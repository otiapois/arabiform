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


def render(page, annots=True):
    pix = page.get_pixmap(matrix=SCALE, colorspace=fitz.csRGB, alpha=False, annots=annots)
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


def check_alignment(spec, document, widget, page, bounds, box, label, authored=False):
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
        if spec["mode"] == "auto" or authored:
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


def check_designer(proof, directory, authored, filled, label):
    with fitz.open(directory / proof["source"]) as flat:
        assert len(flat) == len(authored) == len(filled) == 1
        source, template, completed = flat[0], authored[0], filled[0]
        assert not list(source.widgets()), label
        assert source.rotation == template.rotation == completed.rotation == proof["rotation"], label
        assert render(source, False) == render(template, False) == render(completed, False), (
            label, "source graphics changed without annotations"
        )
        allowed = []
        widgets = list(template.widgets())
        assert {widget.field_name for widget in widgets} == set(proof["rects"]), label
        seen = Counter()
        for widget in widgets:
            mapped = widget.rect * template.rotation_matrix
            actual = [mapped.x0 / template.rect.width, mapped.y0 / template.rect.height,
                      mapped.width / template.rect.width, mapped.height / template.rect.height]
            expected = proof["rects"][widget.field_name]
            if isinstance(expected[0], list):
                expected = expected[seen[widget.field_name]]
            seen[widget.field_name] += 1
            assert all(abs(a - b) < 1e-5 for a, b in zip(actual, expected, strict=True)), (label, actual, expected)
            allowed.append(tuple((mapped * SCALE).irect))
            assert authored.xref_get_key(widget.xref, "MK/R") == ("int", str(template.rotation)), label
            if widget.field_type in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON):
                assert authored.xref_get_key(widget.xref, "AS") == ("name", "/Off"), label
            else:
                assert widget.field_type in (fitz.PDF_WIDGET_TYPE_TEXT, fitz.PDF_WIDGET_TYPE_COMBOBOX) and not widget.field_value, label
        for field, expected in proof["rects"].items():
            assert seen[field] == (len(expected) if isinstance(expected[0], list) else 1), label
        before = render(source)
        assert_same_outside(before, render(template), allowed, f"{label} blank authoring")
        assert_same_outside(before, render(completed), allowed, f"{label} filled authoring")
    return {"rotation": proof["rotation"], "originalPageGraphicsIdentical": True, "viewportRectsMatch": True,
            "outsideOriginalFieldRectsChangedPixels": 0}


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
    designer = None
    if case.get("customFont"):
        fitz.TOOLS.mupdf_warnings(reset=True)
    with fitz.open(before_path) as original, fitz.open(after_path) as filled, fitz.open(after_path) as no_text:
        assert len(original) == len(filled), label
        if case.get("designer"):
            designer = check_designer(case["designer"], directory, original, filled, label)
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
                        elif designer and field in radios:
                            assert amount == 0, (label, field, "unselected authored radio changed its off pixels")
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
                    measured_alignment = check_alignment(alignments[field], filled, widget, page, bounds, box, label, bool(designer)) if field in alignments else {}
                    results.append({"field": field, "page": page.number + 1, "inkBboxAt4x": bounds if amount else None,
                                    "inkPixelsAt4x": amount, "minWidgetEdgeInsetAt4x": inset, **measured_alignment,
                                    **({"dropdownLabel": display} if field in dropdowns else {})})
                assert_same_outside(before, after, allowed, f"{label} page {page.number + 1}")
                assert_same_outside(text_only_baseline, after, allowed, f"{label} text on page {page.number + 1}")
    assert set(seen) == set(expected), (label, seen, list(expected))
    if case.get("customFont"):
        warnings = fitz.TOOLS.mupdf_warnings(reset=True)
        assert not warnings, f"{label}: MuPDF emitted font or appearance warnings: {warnings}"
    return {"label": label, "outsideMappedWidgetChangedPixels": 0, "clippedInkPixels": 0, "widgets": results,
            **({"designer": designer} if designer else {})}


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


def check_cover_ink(page, footer):
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
    evidence = {"page": page.number + 1, "inkBboxAt4x": bounds, "inkPixelsAt4x": amount, "minPageEdgeInsetAt4x": inset}
    if footer:
        left = right = 0
        for y in range(height - 50 * 4, height - margin):
            row = dark[y * width:(y + 1) * width]
            left += row[:width // 2].count(b"\x01")
            right += row[width // 2:].count(b"\x01")
        assert left > 100 and right > 100, f"cover page {page.number + 1}: missing left or right custody footer ink"
        evidence["custodyFooter"] = {"text": footer, "leftInkPixelsAt4x": left, "rightInkPixelsAt4x": right}
    return evidence


def check_bilingual_panel_ink(page):
    width, _, samples = render(page)
    red = samples[::CHANNELS]
    middle = page.rect.width * 2
    left = math.ceil(middle - 12 * 4)
    right = math.floor(middle + 12 * 4)
    table = min(drawing["rect"].y0 for drawing in page.get_drawings() if drawing["rect"].width > 500)
    table_start = math.floor(table * 4) - 2
    white = b"\xff" * (right - left)
    left_ink = right_ink = 0
    for row in range(40 * 4 - 1, table_start):
        start = row * width
        assert red[start + left:start + right] == white, "bilingual cover header ink crossed the central gutter"
        left_ink += red[start:start + left].translate(DARK_PIXELS).count(b"\x01")
        right_ink += red[start + right:start + width].translate(DARK_PIXELS).count(b"\x01")
    assert left_ink > 300 and right_ink > 300, "both bilingual panels need shaped text ink"
    return {"en": left_ink, "ar": right_ink}


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
            titles = expected["titles"] if "titles" in expected else [expected["title"]]
            header = [*titles, *(expected["details"] if page_number == 0 else []), *expected["headings"]]
            assert [text for text, _ in spans[:len(header)]] == header, (spec["pdf"], page_number, spans[:len(header)])
            assert all(b" Tj" in operators for _, operators in spans), f"{spec['pdf']}: cover text span has no glyphs"
            footer = expected.get("footer")
            if footer:
                assert spans[-1][0] == footer, f"{spec['pdf']}: displayed custody fingerprints differ from the source bytes"
            cells = spans[len(header):-1] if footer else spans[len(header):]
            assert len(cells) % 4 == 0, f"{spec['pdf']}: incomplete cover table"
            for offset in range(0, len(cells), 4):
                ordinal, row_number, filename, pages = cells[offset:offset + 4]
                if filename[0] in expected["wrappedFilenames"]:
                    assert filename[1].count(b"BT\n") > 1, f"{spec['pdf']}: expected filename to wrap"
                index_rows.append((ordinal[0], row_number[0], filename[0], pages[0]))
            proof = check_cover_ink(page, footer)
            if "titles" in expected:
                proof["bilingualPanelInkAt4x"] = check_bilingual_panel_ink(page)
            ink.append(proof)
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


def check_qr_stamp(spec, directory):
    modules = spec["modules"]
    size = len(modules)
    assert size in range(21, 42, 4) and all(len(row) == size for row in modules)
    inset = 9 * 4
    stamp = spec["sizePt"] * 4
    cell = stamp / (size + 8)
    finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"]
    cover = spec["coverPages"]
    pages = []
    fitz.TOOLS.mupdf_warnings(reset=True)
    with ZipFile(directory / spec["zip"]) as archive, \
            fitz.open(directory / spec["pdf"]) as merged, \
            fitz.open(directory / spec["plainPdf"]) as plain, \
            fitz.open(stream=archive.read(spec["member"]), filetype="pdf") as member:
        assert len(merged) == len(plain) == cover + len(member)
        for index in range(cover):
            assert render(merged[index]) == render(plain[index]), "QR changed a cover page"
        for index, zip_page in enumerate(member):
            page = merged[cover + index]
            baseline = plain[cover + index]
            assert not list(page.widgets()) and not page.get_images(), "QR output must use vector page content"
            actual = render(page)
            assert actual == render(zip_page), "merged and flattened ZIP QR pixels differ"
            width, height, data = actual
            expected_width, expected_height = page.rect.width * 4, page.rect.height * 4
            x = expected_width - inset - stamp if spec["corner"].endswith("right") else inset
            y = expected_height - inset - stamp if spec["corner"].startswith("bottom") else inset
            allowed = (math.floor(x), math.floor(y), math.ceil(x + stamp), math.ceil(y + stamp))
            assert 0 < allowed[0] < allowed[2] < width and 0 < allowed[1] < allowed[3] < height
            assert_same_outside(render(baseline), actual, [allowed], f"QR page {index + 1}")

            def value(px, py):
                offset = (py * width + px) * CHANNELS
                return data[offset:offset + CHANNELS]

            measured = []
            for row in range(-4, size + 4):
                measured_row = []
                for col in range(-4, size + 4):
                    dark = 0 <= row < size and 0 <= col < size and modules[row][col]
                    monochrome = b"\x00" * CHANNELS if dark else b"\xff" * CHANNELS
                    x0, y0 = x + (col + 4) * cell, y + (row + 4) * cell
                    # Sample the interior of each module and leave room for
                    # raster antialiasing at the borders.
                    cores = [value(px, py) for py in range(math.ceil(y0 + 0.25), math.floor(y0 + cell - 1.25) + 1)
                             for px in range(math.ceil(x0 + 0.25), math.floor(x0 + cell - 1.25) + 1)]
                    assert cores and all(pixel == monochrome for pixel in cores), (spec["pdf"], index, col, row, monochrome, cores)
                    measured_row.append(cores[0] == b"\x00" * CHANNELS)
                if 0 <= row < size:
                    measured.append(measured_row[4:-4])
            assert measured == modules, "independent pixel matrix does not match the expected QR"
            for left, top in ((0, 0), (size - 7, 0), (0, size - 7)):
                assert ["".join(str(int(bit)) for bit in row[left:left + 7]) for row in measured[top:top + 7]] == finder
            # The four-module strips must be completely white away from the
            # shared painted boundaries, including seams between white cells.
            l, t, r, b = math.ceil(x + 0.5), math.ceil(y + 0.5), math.floor(x + stamp - 1.5), math.floor(y + stamp - 1.5)
            inner_l, inner_t, inner_r, inner_b = (x + 4 * cell, y + 4 * cell, x + stamp - 4 * cell, y + stamp - 4 * cell)
            for py in range(t, b + 1):
                for px in range(l, r + 1):
                    if px + 1.5 <= inner_l or px - 0.5 >= inner_r or py + 1.5 <= inner_t or py - 0.5 >= inner_b:
                        assert value(px, py) == b"\xff" * CHANNELS, "non-white quiet zone"
            pages.append({"rotation": page.rotation, "boundsAt4x": allowed, "sizePt": spec["sizePt"],
                          "verifiedModules": size * size, "quietZoneModules": 4, "finderPatterns": 3,
                          "clippedPixels": 0, "pixelDiffOutsideStamp": 0})
    warnings = fitz.TOOLS.mupdf_warnings(reset=True)
    assert not warnings, f"{spec['pdf']}: MuPDF emitted warnings: {warnings}"
    return {"pdf": spec["pdf"], "zip": spec["zip"], "coverPagesUnchanged": cover, "pages": pages}


def check_m20_proof(spec, directory):
    seal = spec["seal"]
    pages = []
    with fitz.open(directory / spec["filled"]) as filled, fitz.open(directory / spec["original"]) as legacy, \
            fitz.open(directory / spec["pdf"]) as stamped, fitz.open(directory / spec["preview"]) as preview, \
            fitz.open(directory / spec["qrReference"]) as qr, fitz.open(directory / spec["printReference"]) as plain, \
            ZipFile(directory / spec["zip"]) as archive, \
            fitz.open(stream=archive.read(spec["filled"]), filetype="pdf") as member:
        assert len(filled) == len(legacy) == len(stamped) == len(preview) == len(qr) == len(member) == 2
        for index, current in enumerate(filled):
            reference = legacy[index]
            overlay = stamped[index]
            base_widgets = {widget.field_name: widget for widget in reference.widgets()}
            widgets = {widget.field_name: widget for widget in current.widgets()}
            assert [widgets[name].field_value for name in ("Date", "ID", "Sentinel")] == ["٠٠١٢٣", "00123", "KEEP 00109"]
            assert [base_widgets[name].field_value for name in ("Date", "ID")] == ["00123", "00123"]
            boxes = {name: tuple((widget.rect * current.rotation_matrix * SCALE).irect) for name, widget in widgets.items()}
            actual, before = render(current), render(reference)
            assert_same_outside(before, actual, [boxes["Date"], boxes["Notes"]], "M20 only Date and Notes can change")
            assert ink_bounds(before, actual, boxes["Date"])[1] > 0, "Eastern and Western numerals are pixel-identical"
            assert ink_bounds(before, actual, boxes["Notes"])[1] > 0, "Notes line-height and padding did not change pixels"

            def notes_layout(doc, widget):
                stream = doc.xref_stream(appearance_xref(doc, widget))
                runs = re.findall(rb"\bBT\n(.*?)\bET\n", stream, re.S)
                assert len(runs) == 2, "M20 Notes must retain both lines"
                positions = [re.findall(rb"1 0 0 1 ([\d.\-]+) ([\d.\-]+) Tm", run) for run in runs]
                baselines = [min(float(y) for _, y in line) for line in positions]
                assert all(b" 12 Tf" in run for run in runs)
                return baselines[0] - baselines[1], [float(x) for line in positions for x, _ in line]

            old_gap, old_notes_x = notes_layout(legacy, base_widgets["Notes"])
            new_gap, new_notes_x = notes_layout(filled, widgets["Notes"])
            # Diacritic offsets are unchanged at the held font size. At least 1 em separates the baselines.
            assert new_gap - old_gap >= 12 * 0.3 - 1e-8, (old_gap, new_gap)
            user_unit = (1, 2)[index]
            padding_increase_pt = 6 - 1.6 * user_unit
            assert all(abs((old - new) * user_unit - padding_increase_pt) < 1e-8
                       for old, new in zip(old_notes_x, new_notes_x, strict=True)), "Notes padding must be measured in physical points"

            width, height, _ = print_pixels = render(overlay)
            assert print_pixels == render(member[index]), "Merged and flattened ZIP pixels differ"
            assert not list(overlay.widgets()) and not overlay.get_images(), "Approval seal output must stay vector"
            inset = 9 * 4
            stamp_width, stamp_height = spec["widthPt"] * 4, spec["heightPt"] * 4
            allowed = (inset, inset, inset + stamp_width, inset + stamp_height)
            assert allowed[2] < width and allowed[3] < height
            qr_only = render(qr[index])
            qr_side = spec["qrSizePt"] * 4
            qr_box = (width - inset - qr_side, height - inset - qr_side, width - inset, height - inset)
            preview_pixels = render(preview[index])
            # MuPDF can paint an interactive widget differently from the same
            # appearance when flattened. Match the two stamps exactly and
            # compare the surrounding content to its own unmarked counterpart.
            assert_same_outside(actual, preview_pixels, [allowed, qr_box], f"M20 preview page {index + 1}")
            assert not any(ink_bounds(print_pixels, preview_pixels, box)[1] for box in (allowed, qr_box)), "Preview and print stamps differ"
            assert_same_outside(qr_only, print_pixels, [allowed], f"M20 approval seal page {index + 1}, including all QR modules")
            bounds, pixels = ink_bounds(qr_only, print_pixels, allowed)
            assert pixels > 500 and min(bounds[0] - allowed[0], bounds[1] - allowed[1], allowed[2] - bounds[2], allowed[3] - bounds[3]) >= 0
            for left, top, right, bottom in boxes.values():
                assert min(allowed[2], right) <= max(allowed[0], left) or min(allowed[3], bottom) <= max(allowed[1], top)
            spans = [bytes.fromhex(value.decode("ascii")).decode("utf-16") for value, _ in COVER_SPAN.findall(overlay.read_contents())]
            assert spans == [seal["labelEn"], seal["labelAr"], seal["issueDate"]], spans
            border = [drawing for drawing in overlay.get_drawings() if drawing["type"] == "s" and drawing["color"]
                      and all(abs(actual - expected) < 1e-5 for actual, expected in zip(drawing["color"], (0.12, 0.23, 0.29), strict=True))]
            assert len(border) == 2, "Missing vector double border"
            pages.append({"rotation": overlay.rotation, "pageSizePt": [overlay.rect.width, overlay.rect.height],
                          "sealBoundsAt4x": allowed, "sealInkBoundsAt4x": bounds, "sealInkPixelsAt4x": pixels,
                          "notesBaselineGapBefore": old_gap, "notesBaselineGapAfter": new_gap, "notesPaddingIncreasePt": padding_increase_pt,
                          "unstampedInteractiveVsFlattenedChangedPixels": ink_bounds(actual, render(plain[index]), (0, 0, width, height))[1],
                          "logicalSealText": spans, "widgetOverlapPixels": 0, "qrPixelsChanged": 0, "pixelsChangedOutsideSeal": 0})
    return {"pages": pages, "easternDate": "٠٠١٢٣", "westernId": "00123", "unmapped": "KEEP 00109",
            "blockedWidget": spec["overlapWithWidget"], "blockedQr": spec["overlapWithQr"]}


def record_boxes(width, height):
    # Recalculate placement from the reference page's displayed dimensions.
    candidates = []
    for paper_width, paper_height, across in ((841.89, 595.28, True), (595.28, 841.89, False),
                                              (595.28, 841.89, True), (841.89, 595.28, False)):
        columns, rows = (2, 1) if across else (1, 2)
        column_width = (paper_width - 36 - (columns - 1) * 18) / columns
        row_height = (paper_height - 36 - (rows - 1) * 18) / rows
        scale = min(column_width / width, row_height / height)
        x = 18 + (column_width - width * scale) / 2
        y = 18 + (row_height - height * scale) / 2
        dx, dy = (column_width + 18, 0) if across else (0, row_height + 18)
        candidates.append((scale, paper_width, paper_height, [(x, y), (x + dx, y + dy)]))
    return max(candidates, key=lambda candidate: candidate[0])


def pixel_box(x0, y0, x1, y1):
    return math.floor(x0 * 4), math.floor(y0 * 4), math.ceil(x1 * 4), math.ceil(y1 * 4)


def cut_mark_boxes(x, y, right, bottom):
    for xx, dx in ((x, -1), (right, 1)):
        for yy, dy in ((y, -1), (bottom, 1)):
            start, end = sorted((xx + dx * 2, xx + dx * 7))
            yield pixel_box(start - 0.5, yy - 0.5, end + 0.5, yy + 0.5)
            start, end = sorted((yy + dy * 2, yy + dy * 7))
            yield pixel_box(xx - 0.5, start - 0.5, xx + 0.5, end + 0.5)


def check_imposed_record(image, source, scale, box, spec, index):
    width, _, pixels = image
    x, y, right, bottom = box
    source_pixmap = source.get_pixmap(matrix=fitz.Matrix(scale * 4, 0, 0, scale * 4, x * 4, y * 4), alpha=False)
    left_px, top_px, right_px, bottom_px = pixel_box(x, y, right, bottom)
    assert abs(source_pixmap.x - left_px) <= 1 and abs(source_pixmap.y - top_px) <= 1
    assert abs(source_pixmap.x + source_pixmap.width - right_px) <= 1 and abs(source_pixmap.y + source_pixmap.height - bottom_px) <= 1
    reference = source_pixmap.samples
    ink = 0
    changed = 0
    for line in range(source_pixmap.height):
        offset = line * source_pixmap.width * CHANNELS
        baseline = reference[offset:offset + source_pixmap.width * CHANNELS]
        offset = ((source_pixmap.y + line) * width + source_pixmap.x) * CHANNELS
        actual = pixels[offset:offset + source_pixmap.width * CHANNELS]
        baseline_red, actual_red = baseline[::CHANNELS], actual[::CHANNELS]
        ink += sum(baseline_red.translate(DARK_PIXELS))
        if actual != baseline:
            changed += sum(abs(old - new) > 48 for old, new in zip(baseline_red, actual_red, strict=True))
    assert ink > 500 and changed < ink * 0.10, (spec["pdf"], index, "imposed source ink differs", ink, changed)
    modules = spec["modules"][index]
    size = len(modules)
    stamp = spec["sizePt"] * scale
    cell = stamp / (size + 8)
    inset = 9 * scale
    stamp_x = right - inset - stamp if spec["corner"].endswith("right") else x + inset
    stamp_y = bottom - inset - stamp if spec["corner"].startswith("bottom") else y + inset
    assert cell * 4 > 2
    for row in range(-4, size + 4):
        for col in range(-4, size + 4):
            px = math.floor((stamp_x + (col + 4.5) * cell) * 4)
            py = math.floor((stamp_y + (row + 4.5) * cell) * 4)
            offset = (py * width + px) * CHANNELS
            dark = 0 <= row < size and 0 <= col < size and modules[row][col]
            assert pixels[offset:offset + CHANNELS] == (b"\x00" if dark else b"\xff") * CHANNELS, (
                spec["pdf"], index, "QR module or quiet zone differs", col, row)
    return {"sourceRotation": source.rotation, "boundsAt4x": [left_px, top_px, right_px, bottom_px],
            "referenceInkPixels": ink, "strongInkDiffAt4x": changed, "exactQrModules": size * size,
            "exactQrPayload": spec["payloads"][index]}


def check_imposition(spec, directory):
    fitz.TOOLS.mupdf_warnings(reset=True)
    with fitz.open(directory / spec["pdf"]) as doc, fitz.open(directory / spec["referencePdf"]) as reference:
        cover_count = spec["coverPages"]
        records = spec["filenames"]
        assert len(doc) == cover_count + math.ceil(len(records) / 2)
        assert len(reference) == cover_count + len(records)
        index_cells = []
        for page in list(doc)[:cover_count]:
            headings = [bytes.fromhex(value.decode("ascii")).decode("utf-16")
                        for value, _ in COVER_SPAN.findall(page.read_contents())]
            assert "Sheets" in headings and "الأوراق" in headings
            index_cells += headings[headings.index("الأوراق") + 1:]
            assert not list(page.widgets()) and not page.get_images() and not page.get_xobjects()
            assert not any(span["opacity"] < 1 for span in page.get_texttrace()), "cover was watermarked"
            check_cover_ink(page, None)
            check_bilingual_panel_ink(page)
        if cover_count:
            assert index_cells == [cell for index, (number, name) in enumerate(zip(spec["rowNumbers"], records, strict=True))
                                   for cell in (str(index + 1), str(number), name, str(cover_count + 1 + index // 2))]
        sheets = []
        for sheet_index, page in enumerate(list(doc)[cover_count:]):
            first = sheet_index * 2
            sources = [reference[cover_count + index] for index in range(first, min(first + 2, len(records)))]
            source_page = sources[0]
            scale, paper_width, paper_height, positions = record_boxes(source_page.rect.width, source_page.rect.height)
            assert abs(page.rect.width - paper_width) < 0.01 and abs(page.rect.height - paper_height) < 0.01
            assert not list(page.widgets()) and not page.get_images()
            assert len([entry for entry in page.get_xobjects() if entry[2] == 0]) == len(sources)
            image = render(page)
            w, h, rgb = image
            allowed = []
            slot_proofs = []
            for slot, (source, (x, y)) in enumerate(zip(sources, positions)):
                right, bottom = x + source.rect.width * scale, y + source.rect.height * scale
                if allowed:
                    _, _, last_right, last_bottom = allowed[0]
                    assert last_right < x * 4 or last_bottom < y * 4, (spec["pdf"], "record boxes overlap")
                allowed.append(pixel_box(x, y, right, bottom))
                slot_proofs.append(check_imposed_record(image, source, scale, (x, y, right, bottom), spec, first + slot))
                for left, top, r, b in cut_mark_boxes(x, y, right, bottom):
                    assert sum(value < 200 for line in range(top, b)
                               for value in rgb[(line * w + left) * CHANNELS:(line * w + r) * CHANNELS:CHANNELS]) >= 12
                    allowed.append((left, top, r, b))
                if spec.get("requireWatermark", True):
                    assert any(0.20 < span["opacity"] < 0.24 and
                               fitz.Rect(x, y, right, bottom).contains(fitz.Rect(span["bbox"]))
                               for span in page.get_texttrace()), (spec["pdf"], first + slot, "vector watermark missing from slot")
            assert_same_outside((w, h, b"\xff" * (w * h * CHANNELS)), image, allowed, spec["pdf"])
            sheets.append({"sheet": cover_count + sheet_index + 1, "records": slot_proofs,
                           "cutLines": 8 * len(sources), "blankSlots": 2 - len(sources), "pixelsOutsideRecordsAndCutLines": 0})
    warnings = fitz.TOOLS.mupdf_warnings(reset=True)
    assert not warnings, f"{spec['pdf']}: MuPDF emitted warnings: {warnings}"
    return {"pdf": spec["pdf"], "coverPages": cover_count, "exactCoverIndexRows": len(records) if cover_count else 0, "sheets": sheets}


def check_studio(spec, directory):
    fitz.TOOLS.mupdf_warnings(reset=True)
    label = spec["id"]
    with fitz.open(directory / spec["before"]) as original:
        assert len(original) == 1
        page = original[0]
        size = spec["sizePt"]
        assert all(abs(actual - expected) < 0.01 for actual, expected in zip((page.rect.width, page.rect.height), size, strict=True))
        spans = [bytes.fromhex(value.decode("ascii")).decode("utf-16") for value, _ in COVER_SPAN.findall(page.read_contents())]
        assert spans[:4] == spec["header"], (label, spans[:4])
        width, height, pixels = render(page, False)
        header_height = 116 if label == "visitor-badge-a6" else 196
        assert sum(pixels[:width * header_height * 4 * CHANNELS:CHANNELS].translate(DARK_PIXELS)) > 1000, (label, "header has no rendered ink")
    for filename in [spec["before"], *spec["after"]]:
        with fitz.open(directory / filename) as doc:
            width, height, pixels = render(doc[0])
            # The side gutters include each 72 pt corner square, its 9 pt
            # printer inset, plus one raster pixel of rounding tolerance.
            gutter = 81 * 4 + 1
            blank = b"\xff" * (gutter * CHANNELS)
            stride = width * CHANNELS
            for offset in range(0, len(pixels), stride):
                assert pixels[offset:offset + len(blank)] == pixels[offset + stride - len(blank):offset + stride] == blank, (
                    label, filename, "template artwork or filled ink entered the corner gutter")
            stripe = 9 * 4 * stride
            assert pixels[:stripe] == pixels[-stripe:] == b"\xff" * stripe, (label, filename, "ink crossed the vertical print margin")
    equal_pages = check_merged({"pdf": spec["printed"], "rows": spec["after"]}, directory)
    assert not fitz.TOOLS.mupdf_warnings(reset=True), label
    return {"id": label, "sizePt": size, "bilingualHeader": spec["header"], "fourClearQrCorners": True,
            "verticalPrintMarginPt": 9, "editableAndPrintedPixelIdentical": equal_pages}


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("manifest", nargs="?", type=Path, default=Path("test-results/pdf-pixels/manifest.json"))
    path = arguments.parse_args().manifest.resolve()
    manifest = json.loads(path.read_text(encoding="utf-8-sig"))
    assert manifest["cases"], "the pixel verification manifest has no cases"
    snapshots = {case["before"] for case in manifest["cases"]}
    snapshots.update(case["designer"]["source"] for case in manifest["cases"] if case.get("designer"))
    for filename in snapshots:
        source = path.parent / filename
        if re.fullmatch(r"source-[0-9a-f]{64}\.pdf", source.name):
            sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
            assert source.name == f"source-{sha256}.pdf", f"source snapshot hash changed: {filename}"
    results = [check_case(case, path.parent) for case in manifest["cases"]]
    merged = sum(check_merged(manifest[key], path.parent) for key in ("merged", "mixedMerged", "m4Merged") if manifest.get(key))
    covered = [check_covered_merge(spec, path.parent) for spec in manifest.get("coveredMerged", [])]
    zipped = check_zip(manifest["choiceZip"], path.parent) if manifest.get("choiceZip") else 0
    watermarks = [check_watermark(spec, path.parent) for spec in manifest.get("watermarkProofs", [])]
    qr_proofs = [check_qr_stamp(spec, path.parent) for spec in manifest.get("qrProofs", [])]
    imposition_proofs = [check_imposition(spec, path.parent) for spec in manifest.get("impositionProofs", [])]
    studio_proofs = [check_studio(spec, path.parent) for spec in manifest.get("studioProofs", [])]
    m20 = check_m20_proof(manifest["m20Proof"], path.parent) if "m20Proof" in manifest else None
    inks = [item["minWidgetEdgeInsetAt4x"] for result in results for item in result["widgets"] if item["minWidgetEdgeInsetAt4x"] is not None]
    summary = {
        "engine": f"PyMuPDF {fitz.__version__}", "scale": 4, "cases": results, "mergedPagesPixelIdentical": merged,
        "flattenedZipPagesPixelIdentical": zipped,
        "coveredMerged": covered, "watermarkProofs": watermarks, "qrProofs": qr_proofs, "impositionProofs": imposition_proofs,
        "studioProofs": studio_proofs,
        **({"m20Proof": m20} if m20 else {}),
        "minWidgetEdgeInsetAt4x": min(inks) if inks else None,
        "leadingZeros": manifest.get("leadingZeros", {}), "m2Templates": manifest.get("m2Templates", []),
        "publicTemplates": manifest.get("publicTemplates", []),
    }
    path.with_name(f"{path.stem}-verification.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{summary['engine']}: {len(results)} fills, {len(inks)} ink-bearing widgets, 0 clipped ink pixels, 0 changed pixels outside mapped widgets, {merged} identical merged pages, {zipped} identical flattened ZIP pages.")
    designed = [item["designer"] for item in results if "designer" in item]
    if designed:
        print(f"Field designer: {len(designed)} authored fills, exact viewport rectangles, identical original page graphics, 0 changed pixels outside drawn fields.")
    if covered:
        cover_pages = sum(len(item["coverPages"]) for item in covered)
        row_pages = sum(item["rowPagesPixelIdentical"] for item in covered)
        verified_rows = sum(item["verifiedIndexRows"] for item in covered)
        print(f"Cover exports: {cover_pages} covers with 0 clipped pixels, {verified_rows} exact index rows, {row_pages} identical form pages with and without a cover.")
        custody_footers = sum("custodyFooter" in page for item in covered for page in item["coverPages"])
        if custody_footers:
            print(f"Custody: {custody_footers} cover footers with exact hash prefixes and visible ink at 4x.")
    if watermarks:
        pages = sum(len(proof["pages"]) for proof in watermarks)
        print(f"Watermarks: {pages} stamped pages with visible ink, 0 clipped pixels, and original dark ink preserved.")
    if qr_proofs:
        stamped = [page for proof in qr_proofs for page in proof["pages"]]
        checked_modules = sum(page["verifiedModules"] for page in stamped)
        print(f"QR: {len(stamped)} identical merged/ZIP stamped pages, {checked_modules} exact modules, 4-module quiet zones, 0 clipped or outside-change pixels.")
    if imposition_proofs:
        sheets = [sheet for proof in imposition_proofs for sheet in proof["sheets"]]
        print(f"2-up: {len(sheets)} A4 sheets, {sum(len(sheet['records']) for sheet in sheets)} vector stamped records "
              f"with exact QR rasters, {sum(sheet['cutLines'] for sheet in sheets)} cut lines, 0 outside ink.")
    if studio_proofs:
        print(f"Template studio: {len(studio_proofs)} bilingual one-page designs with four clear 72 pt QR corners, "
              "9 pt vertical print margins, and both Arabic and English fills.")
    if m20:
        print(f"M20: {len(m20['pages'])} preview/ZIP/merged seal pages (including rotated UserUnit 2), Eastern ٠٠١٢٣ and Western 00123, "
              "custom typography, unchanged QR modules, 0 widget overlap, and both collisions blocked.")


if __name__ == "__main__":
    main()
