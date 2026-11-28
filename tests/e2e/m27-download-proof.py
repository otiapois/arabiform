"""Read all four delivered artifacts independently with zipfile, csv, hashlib and PyMuPDF."""

import csv
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
import re
import sys
from zipfile import ZipFile

import fitz
from PIL import Image, ImageDraw, ImageOps


def archive(path):
    with ZipFile(path) as package:
        assert package.testzip() is None
        names = package.namelist()
        assert len(names) == len(set(names))
        return {name: package.read(name) for name in names}


def pdf(data):
    with fitz.open(stream=data, filetype="pdf") as doc:
        fields = {}
        for page in doc:
            for widget in page.widgets():
                xref = widget.xref
                seen = set()
                while xref not in seen:
                    seen.add(xref)
                    kind, value = doc.xref_get_key(xref, "V")
                    parent_kind, parent = doc.xref_get_key(xref, "Parent")
                    if kind != "null" or parent_kind != "xref":
                        break
                    xref = int(parent.split()[0])
                if kind == "null":
                    continue
                if kind == "name":
                    value = value.removeprefix("/")
                assert kind in ("string", "name"), (kind, value, widget.field_name)
                assert widget.field_value == value
                fields[widget.field_name] = value
        return {"pages": len(doc), "fields": fields, "sha256": sha256(data).hexdigest()}


def cover(path, counts, reprint):
    percent = f'{reprint["savingsPercent"]:.2f}'.rstrip("0").rstrip(".")
    labels = [
        ("Delta Reprint Summary", "مُلَخَّصُ إِعَادَةِ الطِّبَاعَةِ"),
        *[(f"{en}: {n}", f"{ar}: {n}") for en, ar, n in [
            ("Unchanged", "دون تغيير", counts["unchanged"]), ("Modified", "مُعدَّلة", counts["modified"]),
            ("Added", "مُضافة", counts["added"]), ("Removed", "محذوفة", counts["removed"]),
            ("New batch sheets", "أوراق الدفعة الجديدة", reprint["fullPages"]),
            ("Reprint sheets", "أوراق إعادة الطباعة", reprint["deltaPages"]),
            ("Sheets saved", "الأوراق المُوفَّرة", reprint["savedPages"]),
        ]],
        (f"Reprint savings: {percent}%", f"التوفير في الطباعة: {percent}٪"),
        ("One PDF page per sheet.", "كل صفحة من الملف تُطبع على ورقة واحدة."),
    ]
    with fitz.open(path) as doc:
        assert len(doc) == 1
        page = doc[0]
        assert not list(page.widgets()) and not page.get_images()
        marked = re.findall(rb"/Span << /ActualText <([0-9A-F]+)> >> BDC\s+(.*?)\s+EMC", page.read_contents(), re.S)
        texts = [bytes.fromhex(s.decode()).decode("utf-16") for s, ops in marked if b" Tj" in ops]
        assert texts == [label for pair in labels for label in pair], texts
        pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), colorspace=fitz.csGRAY, alpha=False)
        ink = ImageOps.invert(Image.frombytes("L", (pix.width, pix.height), pix.samples)).point(lambda x: 255 if x > 12 else 0)
        x0, y0, x1, y1 = ink.getbbox()
        margins = [x0, y0, pix.width - x1, pix.height - y1]
        assert min(margins) >= 24 * 4, margins
        # Exclude the decorative rules before measuring the bilingual gutter and paired lines.
        for drawing in page.get_drawings():
            rect = drawing["rect"]
            if rect.width > page.rect.width / 2 and rect.height < 1:
                y = round(rect.y0 * 4)
                ImageDraw.Draw(ink).rectangle((0, y - 4, pix.width, y + 4), fill=0)
        mid = pix.width // 2
        assert ink.crop((mid - 18, 0, mid + 18, pix.height)).getbbox() is None
        bands = []
        for left, right in [(0, mid), (mid, pix.width)]:
            half = ink.crop((left, 0, right, pix.height))
            rows = [y for y, active in enumerate(half.getprojection()[1]) if active]
            groups = []
            for y in rows:
                if groups and y - groups[-1][-1] <= 22:
                    groups[-1].append(y)
                else:
                    groups.append([y])
            actual = [[ys[0], ys[-1]] for ys in groups]
            assert len(actual) == len(labels), (left, actual)
            assert all(end - start > 12 for start, end in actual)
            bands.append(actual)
        for left, right in zip(*bands, strict=True):
            assert max(left[0], right[0]) <= min(left[1], right[1]), (left, right)
        return {"scale": 4, "pagePixels": [pix.width, pix.height], "inkMarginsPixels": margins,
                "pairedInkBands": len(labels), "measuredBands": bands, "inkInCentralGutter": 0, "printedText": texts}


def verify(directory, previous, new):
    hashes = {name: sha256(path.read_bytes()).hexdigest() for name, path in [
        ("previousSha256", previous), ("nextSha256", new), ("deltaSha256", directory / "delta-reprint-pdfs.zip")]}
    audit = json.loads((directory / "batch-diff-audit.json").read_bytes())
    assert audit["version"] == 1 and audit["hashes"] == hashes
    old, current, delta = map(archive, (previous, new, directory / "delta-reprint-pdfs.zip"))
    entries = {entry["path"]: entry for entry in audit["entries"]}
    assert len(entries) == len(audit["entries"]) and set(entries) == old.keys() | current.keys()
    expected_counts = dict.fromkeys(("unchanged", "modified", "added", "removed"), 0)
    expected_delta, changed_values, csv_items = {}, {}, []
    full_pages = delta_pages = 0
    for path in sorted(entries):
        entry = entries[path]
        status = ("added" if path not in old else "removed" if path not in current
                  else "unchanged" if old[path] == current[path] else "modified")
        expected_counts[status] += 1
        assert entry["status"] == status
        old_info = pdf(old[path]) if path in old else {}
        new_info = pdf(current[path]) if path in current else {}
        for info, side in [(old_info, "previous"), (new_info, "next")]:
            assert (entry[side+"Path"], entry[side+"Sha256"], entry[side+"Pages"]) == (
                path if info else None, info.get("sha256"), info.get("pages"))
        full_pages += new_info.get("pages", 0)
        if status in ("modified", "added"):
            expected_delta[path] = current[path]
            delta_pages += new_info["pages"]
        old_fields, new_fields = old_info.get("fields", {}), new_info.get("fields", {})
        changes = {field: [old_fields.get(field), new_fields.get(field)] for field in sorted(old_fields.keys() | new_fields.keys())
                   if old_fields and new_fields and old_fields.get(field) != new_fields.get(field)}
        assert entry["fieldChanges"] == [{"field": key, "oldValue": values[0], "newValue": values[1]} for key, values in changes.items()]
        reason = "field-value-change" if changes else "visual-or-flattened-change" if status == "modified" else None
        assert entry["reason"] == reason
        if changes:
            changed_values[path] = changes
        for field, (old_value, new_value) in (changes or {"": ["", ""]}).items():
            csv_items.append((path, status, reason or "", field, old_value, new_value, old_info.get("sha256", ""), new_info.get("sha256", "")))
    assert delta == expected_delta and audit["counts"] == expected_counts
    reprint = audit["reprint"]
    assert [reprint[k] for k in ("fullPages", "deltaPages", "savedPages", "sheetsPerPage")] == [full_pages, delta_pages, full_pages - delta_pages, 1]
    assert math.isclose(reprint["savingsPercent"], 100 * (full_pages - delta_pages) / full_pages, abs_tol=.005)
    raw_csv = (directory / "batch-diff-audit.csv").read_bytes()
    assert b"\r\n" in raw_csv and b"\n" not in raw_csv.replace(b"\r\n", b"")
    with (directory / "batch-diff-audit.csv").open(encoding="utf-8-sig", newline="") as file:
        summary, *rows = list(csv.DictReader(file))
    assert summary["record_type"] == "summary" and all(row["record_type"] == "pdf" for row in rows)
    assert [summary[k + "_zip_sha256"] for k in ("previous", "next", "delta")] == list(hashes.values())
    assert all(int(summary[k]) == value for k, value in expected_counts.items())
    assert [int(summary[k]) for k in ("full_pages", "delta_pages", "saved_pages", "sheets_per_page")] == [full_pages, delta_pages, full_pages - delta_pages, 1]
    assert math.isclose(float(summary["savings_percent"]), reprint["savingsPercent"])
    keys = ("path", "status", "reason", "field", "old_value", "new_value", "previous_pdf_sha256", "next_pdf_sha256")
    assert sorted(tuple(row[k] for k in keys) for row in rows) == sorted(csv_items)
    return {"hashes": hashes, "counts": expected_counts, "reprint": reprint, "members": sorted(delta),
            "changedValues": changed_values, "summary": cover(directory / "delta-reprint-summary.pdf", expected_counts, reprint)}


if __name__ == "__main__":
    print(json.dumps(verify(*(Path(arg) for arg in sys.argv[1:])), ensure_ascii=True))
