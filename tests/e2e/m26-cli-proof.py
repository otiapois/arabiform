"""Run the real local CLI against fresh synthetic payroll inputs and inspect its actual files."""

import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile

import fitz


def main(root, node):
    root.mkdir(parents=True, exist_ok=False)
    fixtures = Path("fixtures/m26").resolve()
    with (fixtures / "gcc-payroll.csv").open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    rows.append({**rows[0], "EmployeeID": "0012345681"})
    rows[0]["Effective Date"] = "2026-04-31"
    assert rows[1]["IBAN"] == "SA31 0000 0000 0000 0001 0002" and rows[2]["Effective Date"] == "2026-02-29"

    def roster(name):
        path = root / (name + ".csv")
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        return path

    def invoke(name, mode, source, exit_code):
        output = root / name
        args = [node, "--import", "tsx", "scripts/arabiform-cli.ts", "--mode", mode,
                "--template", str(fixtures / "gcc-payroll.pdf"), "--roster", str(source),
                "--preset", str(fixtures / "gcc-payroll-preset-v13.json"), "--out-dir", str(output)]
        if mode == "fill":
            args.append("--strict")
        run = subprocess.run(args, capture_output=True, encoding="utf-8", timeout=180, check=False)
        (root / (name + ".stderr")).write_text(run.stderr, encoding="utf-8")
        (root / (name + ".stdout")).write_text(run.stdout, encoding="utf-8")
        assert run.returncode == exit_code, (name, run.returncode, run.stderr)
        response = json.loads(run.stderr if name == "held" else run.stdout)
        return output, response

    bad = roster("invalid-dates-and-iban")
    held, blocked = invoke("held", "fill", bad, 2)
    assert blocked["status"] == "flagged" and blocked["ready"] == 1 and blocked["flagged"] == 3
    assert not list(held.rglob("*"))
    preflight, report = invoke("preflight", "preflight", bad, 2)
    saved = json.loads((preflight / "arabiform-preflight.json").read_bytes())
    assert report == {**saved, "outputs": ["arabiform-preflight.csv", "arabiform-preflight.json"]}
    assert set(p.name for p in preflight.iterdir()) == {"arabiform-preflight.csv", "arabiform-preflight.json"}
    with (preflight / "arabiform-preflight.csv").open(encoding="utf-8-sig", newline="") as stream:
        audit = list(csv.DictReader(stream))
    issues = [r["schemaDiagnostics"] for r in saved["rows"]]
    assert [json.loads(r["schemaDiagnostics"]) for r in audit] == issues == [r["schemaDiagnostics"] for r in blocked["rows"]]
    assert issues[3] == []
    for number, (items, expected) in enumerate(zip(issues[:3], [
        ("Effective Date", "iso-date", "iso-date"), ("IBAN", "iban-mod97", "iban-checksum"), ("Effective Date", "iso-date", "iso-date")
    ], strict=True), start=1):
        assert len(items) == 1
        issue = items[0]
        assert issue["code"] == "schema-validation-failed" and issue["rowNumber"] == number
        assert (issue["column"], issue["rule"], issue["reasonCode"]) == expected
        assert issue["reason"]["en"].isascii() and any("\u0600" <= c <= "\u06ff" for c in issue["reason"]["ar"])
    rows[0]["Effective Date"] = "2024-02-29"
    rows[1]["IBAN"] = "SA31 0000 0000 0000 0001 0001"
    rows[2]["Effective Date"] = "2026-04-30"
    repaired, clean = invoke("repaired", "fill", roster("repaired-rows"), 0)
    assert clean["status"] == "clean" and clean["ready"] == len(rows) and clean["flagged"] == 0
    assert all(r["schemaDiagnostics"] == [] for r in clean["rows"])
    pdfs = {}
    with ZipFile(repaired / "arabiform-editable.zip") as archive:
        assert archive.namelist() == [r["EmployeeID"] + ".pdf" for r in rows]
        for row in rows:
            filename = row["EmployeeID"] + ".pdf"
            data = archive.read(filename)
            with fitz.open(stream=data, filetype="pdf") as doc:
                fields = {w.field_name: w.field_value for w in doc[0].widgets()}
                assert fields == {**{k: v for k, v in row.items() if k != "Department"}, "Sentinel": "KEEP 00109"}
            pdfs[filename] = hashlib.sha256(data).hexdigest()
    with ZipFile(repaired / "arabiform-flattened.zip") as archive:
        assert archive.namelist() == list(pdfs)
    with fitz.open(repaired / "arabiform-merged.pdf") as merged:
        assert len(merged) == len(pdfs)
    summary = {"node": node, "preset": "v13", "strict": {"heldExit": 2, "heldFiles": 0, "repairedExit": 0},
               "preflightExit": 2, "issues": issues, "editablePdfs": pdfs, "mergedPages": len(pdfs)}
    (root / "receipt.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve(), sys.argv[2])
