"""Sample the optical symbol on each PDF delivered by Edge, independently of the UI preview."""
import json
import sys
from pathlib import Path
from zipfile import ZipFile

import fitz


def raster(page):
    pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), colorspace=fitz.csGRAY, alpha=False)
    return pix.width, pix.height, pix.samples


def main(editable_path, printed_path):
    result = []
    with ZipFile(editable_path) as editable, ZipFile(printed_path) as printed:
        assert printed.namelist() == editable.namelist() and len(printed.namelist()) == 2
        for name in printed.namelist():
            with fitz.open(stream=editable.read(name), filetype="pdf") as before, \
                    fitz.open(stream=printed.read(name), filetype="pdf") as after:
                assert len(before) == len(after) == 1
                assert len(list(before[0].widgets())) == 5 and not list(after[0].widgets())
                assert not after[0].get_images(), "expected a vector stamp"
                width, height, expected = raster(before[0])
                w, h, actual = raster(after[0])
                assert (w, h) == (width, height)
                # Top-left, 9 pt inset, 48 pt square. These two short records fit QR version 2-M.
                left = top = 9 * 4
                side = 48 * 4
                assert expected[:top * width] == actual[:top * width]
                end = (top + side) * width
                assert expected[end:] == actual[end:]
                changed = 0
                for y in range(top, top + side):
                    start = y * width
                    x0, x1 = start + left, start + left + side
                    assert expected[start:x0] == actual[start:x0]
                    assert expected[x1:start + width] == actual[x1:start + width]
                    changed += sum(a != b for a, b in zip(expected[x0:x1], actual[x0:x1]))
                assert changed > 1000, "expected a visible printed stamp"
                size = 25
                centers = [int((cell + 0.5) * side / (size + 8)) for cell in range(size + 8)]
                grid = [[actual[(top + y) * width + left + x] for x in centers] for y in centers]
                for y, row in enumerate(grid):
                    for x, pixel in enumerate(row):
                        assert pixel in (0, 255)
                        if not (4 <= x < size + 4 and 4 <= y < size + 4):
                            assert pixel == 255, "quiet zone pixel must be white"
                modules = [[pixel == 0 for pixel in row[4:-4]] for row in grid[4:-4]]
                positions = [(size - 1 - i, 8) if i < 8 else (8, size - 15 + i) for i in range(15)]
                format_word = sum(int(modules[y][x]) << i for i, (x, y) in enumerate(positions))
                result.append(dict(filename=name, size=size, version=2, mask=((format_word ^ 0x5412) >> 10) & 7,
                                   modules=modules, outsideChangedPixels=0))
    print(json.dumps(result))


if __name__ == "__main__":
    main(*(Path(arg) for arg in sys.argv[1:]))
