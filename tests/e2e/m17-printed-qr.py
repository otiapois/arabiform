"""Sample the optical symbol on each PDF delivered by Edge, independently of the UI preview."""
import json
import sys
from pathlib import Path
from zipfile import ZipFile

import fitz
import numpy as np


def raster(page):
    pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), colorspace=fitz.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)


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
                expected, actual = raster(before[0]), raster(after[0])
                # Top-left, 9 pt inset, 48 pt square. These two short records fit QR version 2-M.
                left = top = 9 * 4
                side = 48 * 4
                diff = expected != actual
                assert diff[top:top + side, left:left + side].sum() > 1000
                diff[top:top + side, left:left + side] = False
                assert not diff.any(), "flattening or stamping changed pixels outside the QR square"
                size = 25
                centers = ((np.arange(size + 8) + 0.5) * side / (size + 8)).astype(int)
                grid = actual[np.ix_(top + centers, left + centers)]
                assert np.isin(grid, [0, 255]).all()
                assert (grid[:4] == 255).all() and (grid[-4:] == 255).all()
                assert (grid[:, :4] == 255).all() and (grid[:, -4:] == 255).all()
                modules = (grid[4:-4, 4:-4] == 0).tolist()
                positions = [(size - 1 - i, 8) if i < 8 else (8, size - 15 + i) for i in range(15)]
                format_word = sum(int(modules[y][x]) << i for i, (x, y) in enumerate(positions))
                result.append(dict(filename=name, size=size, version=2, mask=((format_word ^ 0x5412) >> 10) & 7,
                                   modules=modules, outsideChangedPixels=int(diff.sum())))
    print(json.dumps(result))


if __name__ == "__main__":
    main(*(Path(arg) for arg in sys.argv[1:]))
