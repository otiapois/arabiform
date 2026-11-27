"""Read a real Edge/CLI packet, including marked text and visible 4x ink on each page."""
import hashlib
import json
import re
import sys
from pathlib import Path

import fitz


marked = re.compile(rb"/Span\s*<<\s*/ActualText\s*<([0-9A-Fa-f]+)>\s*>>\s*BDC(.*?)EMC", re.S)


def labels(program):
    return [bytes.fromhex(value.decode("ascii")).decode("utf-16") for value, operators in marked.findall(program)
            if b" Tj" in operators]


def inspect(path, documents, expected_fields):
    pages = []
    with fitz.open(path) as packet:
        assert len(packet) == sum(doc["pageCount"] for doc in documents) + 1
        expected_cover = ["Packet Document Index", "فِهْرِسُ مُسْتَنَدَاتِ الحُزْمَةِ", "Document", "المستند",
                          "Start page", "صفحة البداية"]
        for doc in documents:
            expected_cover.extend([doc["title"], str(doc["startPage"])])
        cover = labels(packet[0].read_contents())
        assert cover == expected_cover, (cover, expected_cover)
        for index, page in enumerate(packet):
            assert not list(page.widgets() or ()), (path, index + 1, "live widget")
            raster = page.get_pixmap(matrix=fitz.Matrix(4, 4), colorspace=fitz.csGRAY, alpha=False)
            pixels = raster.samples
            dark = pixels.translate(bytes(int(level < 128) for level in range(256))).count(1)
            assert dark > 100, (path, index + 1, dark)
            texts = labels(page.read_contents())
            for xref, _, _, _ in page.get_xobjects():
                texts.extend(labels(packet.xref_stream(xref)))
            if expected_fields:
                for value in expected_fields.get(str(index + 1), []):
                    assert value in texts, (index + 1, value, texts)
            pages.append({"page": index + 1, "rotation": page.rotation, "raster": [raster.width, raster.height],
                          "darkPixels": dark, "sha256Raster": hashlib.sha256(pixels).hexdigest(), "widgets": 0, "texts": texts})
    return {"file": Path(path).name, "scale": 4, "cover": cover, "pages": pages}


if __name__ == "__main__":
    print(json.dumps(inspect(sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3]))))
