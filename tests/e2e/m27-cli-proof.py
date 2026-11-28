"""Exercise the native diff-batch entry point with safe synthetic ZIP validation cases."""

import json
from pathlib import Path
import runpy
import subprocess
import sys
import warnings
from zipfile import ZipFile


def main(root, node):
    root.mkdir(parents=True, exist_ok=False)
    fixtures = Path("fixtures/m27").resolve()
    previous, new = (fixtures / (side + "-batch.zip") for side in ("previous", "next"))
    verify = runpy.run_path(str(Path(__file__).with_name("m27-download-proof.py")))["verify"]
    results = {}

    def call(label, first, second, expected_code, layer=None, side=None):
        out = root / label
        args = [node, "--import", "tsx", "scripts/arabiform-cli.ts", "--mode", "diff-batch",
                "--previous", str(first), "--next", str(second), "--out-dir", str(out)]
        run = subprocess.run(args, capture_output=True, encoding="utf-8", timeout=180)
        (root / (label + ".stdout")).write_text(run.stdout, encoding="utf-8")
        (root / (label + ".stderr")).write_text(run.stderr, encoding="utf-8")
        assert run.returncode == expected_code, (label, run.returncode, run.stderr)
        files = sorted(p.name for p in out.glob("*") if p.is_file())
        response = json.loads(run.stderr if expected_code else run.stdout)
        if expected_code:
            assert files == [] and run.stdout == "" and response["status"] == "blocked"
            assert len(response["issues"]) == 1
            issue = response["issues"][0]
            assert (issue["code"], issue["batch"]) == (layer, side), issue
        else:
            assert run.stderr == "" and response["status"] == "clean"
            assert sorted(response["outputs"]) == files == [
                "batch-diff-audit.csv", "batch-diff-audit.json", "delta-reprint-pdfs.zip", "delta-reprint-summary.pdf"]
            proof = verify(out, first, second)
            assert {key: response[key] for key in ("hashes", "reprint", "counts")} == {
                key: proof[key] for key in ("hashes", "reprint", "counts")}
            (out / "independent-proof.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8")
        results[label] = {"exit": run.returncode, "files": files, "response": response}

    call("clean", previous, new, 0)
    call("identical", new, new, 0)
    with ZipFile(new) as source:
        sample = source.read("certificates/record-001.pdf")
    cases = [
        ("dot-parent", "unsafe-path", [("inside/../record.pdf", sample)]),
        ("duplicate", "duplicate-path", [("record.pdf", sample), ("record.pdf", sample)]),
        ("non-pdf-entry", "non-pdf-entry", [("notes.txt", b"Notes")]),
        ("unreadable-pdf", "invalid-pdf", [("record.pdf", b"Not a PDF")]),
    ]
    for label, layer, entries in cases:
        path = root / (label + ".zip")
        with warnings.catch_warnings(), ZipFile(path, "w") as package:
            warnings.filterwarnings("ignore", message="Duplicate name", category=UserWarning)
            for name, contents in entries:
                package.writestr(name, contents)
        call(label, previous, path, 2, layer, "next")
    broken = root / "damaged.zip"
    broken.write_bytes(b"This file is not an archive")
    call("corrupt", broken, new, 2, "invalid-zip", "previous")
    (root / "receipt.json").write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(results)} native subprocesses with independent file and receipt checks passed.")


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2])
