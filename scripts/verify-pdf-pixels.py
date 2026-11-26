"""Independent 4x visual and widget-value verifier for local generated PDF files."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

import fitz


SCALE = fitz.Matrix(4, 4)
CHANNELS = 3
TEXT_LAYER = re.compile(rb"/Tx BMC\r?\n.*?(?=\r?\nQ(?:\r?\n|$))", re.S)


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


def check_case(case, directory):
    before_path, after_path = (directory / case[key] for key in ("before", "after"))
    expected = case["values"]
    label = case.get("label", after_path.name)
    seen = Counter()
    results = []
    with fitz.open(before_path) as original, fitz.open(after_path) as filled, fitz.open(after_path) as no_text:
        assert len(original) == len(filled), label
        edited = set()
        for page in filled:
            for widget in page.widgets():
                if widget.field_name not in expected:
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
                        assert filled.xref_get_key(widget.xref, "AP") == original.xref_get_key(old_widget.xref, "AP"), f"{label}: unmapped {field} /AP changed"
                        continue
                    seen[field] += 1
                    assert (widget.field_value or "") == expected[field], (label, field, widget.field_value, expected[field])
                    mapped = (widget.rect * page.rotation_matrix * SCALE).irect
                    box = (max(0, mapped.x0), max(0, mapped.y0), min(after[0], mapped.x1), min(after[1], mapped.y1))
                    assert box[2] > box[0] and box[3] > box[1], (label, field, box)
                    allowed.append(box)
                    bounds, amount = ink_bounds(text_only_baseline, after, box)
                    if expected[field].strip():
                        assert amount, f"{label}: {field} has no visible ink"
                        inset = min(bounds[0] - box[0], bounds[1] - box[1], box[2] - bounds[2], box[3] - bounds[3])
                        assert inset >= 3, (label, field, ink_bounds(text_only_baseline, after, box), box)
                    else:
                        assert not amount, f"{label}: blank {field} has visible ink"
                        inset = None
                    results.append({"field": field, "page": page.number + 1, "inkBboxAt4x": bounds if amount else None, "inkPixelsAt4x": amount, "minWidgetEdgeInsetAt4x": inset})
                assert_same_outside(before, after, allowed, f"{label} page {page.number + 1}")
                assert_same_outside(text_only_baseline, after, allowed, f"{label} text on page {page.number + 1}")
    assert set(seen) == set(expected), (label, seen, list(expected))
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


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("manifest", nargs="?", type=Path, default=Path("test-results/pdf-pixels/manifest.json"))
    path = arguments.parse_args().manifest.resolve()
    manifest = json.loads(path.read_text(encoding="utf-8-sig"))
    assert manifest["cases"], "the pixel verification manifest has no cases"
    for filename in {case["before"] for case in manifest["cases"]}:
        sha256 = hashlib.sha256((path.parent / filename).read_bytes()).hexdigest()
        assert filename == f"source-{sha256}.pdf", f"source snapshot hash changed: {filename}"
    results = [check_case(case, path.parent) for case in manifest["cases"]]
    merged = check_merged(manifest["merged"], path.parent) if "merged" in manifest else 0
    inks = [item["minWidgetEdgeInsetAt4x"] for result in results for item in result["widgets"] if item["minWidgetEdgeInsetAt4x"] is not None]
    summary = {
        "engine": f"PyMuPDF {fitz.__version__}", "scale": 4, "cases": results, "mergedPagesPixelIdentical": merged,
        "minWidgetEdgeInsetAt4x": min(inks) if inks else None,
        "leadingZeros": manifest.get("leadingZeros", {}), "m2Templates": manifest.get("m2Templates", []),
        "publicTemplates": manifest.get("publicTemplates", []),
    }
    path.with_name(f"{path.stem}-verification.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{summary['engine']}: {len(results)} fills, {len(inks)} ink-bearing widgets, 0 clipped ink pixels, 0 changed pixels outside mapped widgets, {merged} identical merged pages.")


if __name__ == "__main__":
    main()
