"""Measure raster changes in the live Edge canvas and the corresponding downloaded PDFs."""

import json
import math
from pathlib import Path
import runpy
import sys

import fitz
from PIL import Image, ImageChops


def raster(document):
    page = document[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), colorspace=fitz.csRGB, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def compare(before, after, rect, page_size):
    assert before.size == after.size
    box = (math.floor(rect.x0 * after.width / page_size.width), math.floor(rect.y0 * after.height / page_size.height),
           math.ceil(rect.x1 * after.width / page_size.width), math.ceil(rect.y1 * after.height / page_size.height))
    delta = ImageChops.difference(before, after)
    changed = delta.getbbox()
    assert changed is not None
    assert box[0] < changed[0] < changed[2] < box[2] and box[1] < changed[1] < changed[3] < box[3], (box, changed)
    return {"widget": box, "changed": changed, "outsideChanges": 0}


def verify(spec):
    directory = Path(spec["dir"])
    read = lambda stage: Image.open(directory / (stage + ".png")).convert("RGB")
    witness = runpy.run_path("scripts/verify-pdf-pixels.py")["check_case"]
    cases = []
    with fitz.open(spec["template"]) as original:
        page = original[0]
        rects = {w.field_name: w.rect for w in page.widgets()}
        for source, target, field in (("original", "last", "ID"), ("last", "review", "Name")):
            with fitz.open(directory / (source + ".pdf")) as before, fitz.open(directory / (target + ".pdf")) as after:
                page_text = after[0].get_text("text")
                for prefix in spec["forbidden"][target]:
                    assert prefix not in page_text
                values = spec["values"][target]
                case = {"before": spec["template"], "after": target + ".pdf", "values": values}
                visual = witness(case, directory)
                cases.append({"stage": target, "fourTimes": compare(raster(before), raster(after), rects[field], page.rect),
                              "canvas": compare(read(source), read(target), rects[field], page.rect), "ink": visual})
        with fitz.open(directory / "review.pdf") as review, fitz.open(directory / "literal.pdf") as literal:
            assert ImageChops.difference(raster(review), raster(literal)).getbbox() is None
            assert ImageChops.difference(read("review"), read("literal")).getbbox() is None
    return {"stages": cases, "literalControl4xIdentical": True, "literalControlCanvasIdentical": True}


if __name__ == "__main__":
    print(json.dumps(verify(json.load(sys.stdin))))
