"""Exercise the installed Node CLI using only synthetic local inputs and fresh outputs."""

import csv
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import time


def main(root, node):
    root.mkdir(parents=True, exist_ok=False)
    parse = runpy.run_path("tests/e2e/m25-dispatch-proof.py")["verify"]
    inputs = [
        {"Name": "نسرين شريف", "ID": "00518130", "Email": "first@example.test", "CopyEmail": "copy@example.test",
         "Stem": "ملف/مشترك", "Ticket": "A {{ID}}"},
        {"Name": "Maya", "ID": "00723901", "Email": "second@example.test", "CopyEmail": "",
         "Stem": "ملف?مشترك", "Ticket": "B {{Name}}"},
    ]
    prefix = "إشعار المراجعة · Clinic review · " * 3
    preset = root / "dispatch-preset.json"
    preset.write_text(json.dumps({"version": 1, "mapping": {"Name": "Name", "ID": "ID"},
                                 "filenamePattern": "{{Stem}}.pdf", "minFontSize": 8, "font": "auto"}), encoding="utf-8")
    results = []

    def invoke(name, changes=None, subject=None, body=None, masked=False, expected=None):
        selected = [dict(row) for row in inputs]
        if changes:
            selected[1].update(changes)
        roster = root / (name + ".csv")
        with roster.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=selected[0].keys())
            writer.writeheader()
            writer.writerows(selected)
        output = root / name
        args = [node, "--import", "tsx", "scripts/arabiform-cli.ts", "--mode", "fill",
                "--template", "fixtures/m3/clinic-consent-mixed.pdf", "--roster", str(roster),
                "--strict", "--preset", str(preset), "--dispatch-eml", "Email", "--dispatch-cc", "CopyEmail",
                "--dispatch-subject", subject if subject is not None else prefix + "{{Ticket}}",
                "--dispatch-body", body if body is not None else "Hello / مرحبا\n{{ID}} · {{Ticket}}",
                "--out-dir", str(output)]
        if masked:
            args.extend(["--redact-field", "ID=keep-last-4", "--redact-field", "Name=full-mask"])
        start = time.monotonic()
        run = subprocess.run(args, capture_output=True, encoding="utf-8", timeout=180, check=False)
        (root / (name + ".stdout")).write_text(run.stdout, encoding="utf-8")
        (root / (name + ".stderr")).write_text(run.stderr, encoding="utf-8")
        assert run.returncode == (2 if expected else 0), (name, run.returncode, run.stderr)
        result = {"case": name, "exit": run.returncode, "seconds": round(time.monotonic() - start, 3)}
        if expected:
            response = json.loads(run.stderr)
            assert response["status"] == "blocked" and response["issues"] == expected, (name, response)
            assert not list(output.glob("**/*"))
            result.update(issues=response["issues"], outputFiles=0)
        else:
            drafts = []
            for i, row in enumerate(selected):
                values = {"Name": "*" * len(row["Name"]), "ID": "****" + row["ID"][-4:]} if masked else {
                    "Name": row["Name"], "ID": row["ID"]}
                drafts.append({"rowNumber": i + 1, "to": row["Email"], **({"cc": row["CopyEmail"]} if row["CopyEmail"] else {}),
                               "filename": ["ملفمشترك.pdf", "ملفمشترك-2.pdf"][i], "subject": prefix + row["Ticket"],
                               "body": "Safe copy" if masked else "Hello / مرحبا\n" + row["ID"] + " · " + row["Ticket"],
                               "values": values})
            result["drafts"] = parse({"pack": output / "arabiform-email-drafts.zip", "pdfZip": output / "arabiform-editable.zip",
                                      "csv": output / "dispatch-ledger.csv", "json": output / "dispatch-ledger.json",
                                      "redactedFields": ["Name", "ID"] if masked else [], "rows": drafts})
        results.append(result)

    invoke("valid")
    invoke("review", body="Safe copy", masked=True)
    for index, (column, kind, code, value) in enumerate([
        ("Email", "to", "invalid-recipient", ""),
        ("Email", "to", "invalid-recipient", "incomplete"),
        ("Email", "to", "invalid-recipient", "two\r@example.test"),
        ("Email", "to", "invalid-recipient", "two\n@example.test"),
        ("CopyEmail", "cc", "invalid-cc", "incomplete"),
        ("CopyEmail", "cc", "invalid-cc", "copy\r\n@example.test"),
        ("Ticket", "subject", "invalid-header", "two\rlines"),
        ("Ticket", "subject", "invalid-header", "two\nlines"),
        ("Stem", "attachment", "invalid-attachment", "two\rlines"),
        ("Stem", "attachment", "invalid-attachment", "two\nlines"),
    ]):
        invoke("invalid-" + str(index + 1), {column: value}, expected=[{"rowNumber": 2, "code": code, "field": kind}])
    invoke("invalid-subject-setting", subject="two\r\nlines",
           expected=[{"rowNumber": n, "code": "invalid-header", "field": "subject"} for n in (1, 2)])
    (root / "receipt.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results))


if __name__ == "__main__":
    default_node = shutil.which("node")
    main(Path(sys.argv[1]).resolve(), sys.argv[2] if len(sys.argv) > 2 else default_node)
