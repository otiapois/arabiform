"""Parse real offline downloads using Python's independent mail, ZIP and CSV readers."""

import base64
import csv
from email import policy
from email.parser import BytesParser
import hashlib
import io
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile

import fitz


def verify(spec):
    digest = lambda data: hashlib.sha256(data).hexdigest()
    rows = spec["rows"]
    fields = sorted(spec.get("redactedFields", []))
    with ZipFile(spec["pack"]) as drafts, ZipFile(spec["pdfZip"]) as pdfs:
        ledger = json.loads(drafts.read("dispatch-ledger.json"))
        csv_bytes = drafts.read("dispatch-ledger.csv")
        assert csv_bytes == Path(spec["csv"]).read_bytes()
        if spec.get("json"):
            assert json.loads(Path(spec["json"]).read_bytes()) == ledger
        custody = json.loads(drafts.read("custody-manifest.json"))
        assert ledger["version"] == 1
        for record in (custody, ledger):
            assert bool(record.get("redactedReview")) == bool(fields)
            assert sorted(record.get("redactedFields", [])) == fields
        entries = ledger["entries"]
        flattened = spec.get("flattened", False)
        assert custody["attachmentVariant"] == ("flattened" if flattened else "editable")
        assert [entry["rowNumber"] for entry in entries] == [row["rowNumber"] for row in rows]
        assert custody["selectedRowNumbers"] == [row["rowNumber"] for row in rows]
        assert sorted(drafts.namelist()) == sorted(["dispatch-ledger.csv", "dispatch-ledger.json", "custody-manifest.json"]
                                                   + [entry["emlFilename"] for entry in entries])
        assert sorted(pdfs.namelist()) == sorted(entry["pdfZipPath"] for entry in entries)
        records = list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig"), newline="")))
        proofs = []
        for row, entry, record in zip(rows, entries, records, strict=True):
            assert entry["recipient"] == row["to"]
            assert entry.get("cc") == row.get("cc")
            assert entry["pdfFilename"] == row["filename"]
            assert entry["pdfZipPath"].rsplit("/", 1)[-1] == row["filename"]
            expected_csv = {key: str(value) for key, value in entry.items()}
            expected_csv.setdefault("cc", "")
            assert record == expected_csv
            raw = drafts.read(entry["emlFilename"])
            assert raw.endswith(b"\r\n") and not re.search(rb"(?<!\r)\n|\r(?!\n)", raw)
            assert all(len(line) <= 998 for line in raw.split(b"\r\n"))
            msg = BytesParser(policy=policy.default).parsebytes(raw)
            for part in msg.walk():
                assert not part.defects
                for _, header in part.items():
                    assert not header.defects
            for name, expected in (("To", row["to"]), ("Subject", row["subject"]), ("X-Unsent", "1"), ("MIME-Version", "1.0")):
                assert list(map(str, msg.get_all(name, []))) == [expected], name
            assert list(map(str, msg.get_all("Cc", []))) == ([row["cc"]] if row.get("cc") else [])
            assert len(msg.get_all("Date", [])) == len(msg.get_all("From", [])) == 1
            assert msg["Date"].datetime is not None and msg["From"].addresses
            assert msg.get_content_type() == "multipart/mixed"
            header_block = raw.partition(b"\r\n\r\n")[0]
            subject = re.search(rb"(?:^|\r\n)(Subject:[^\r\n]*(?:\r\n[ \t][^\r\n]*)*)", header_block).group(1)
            lines = subject.split(b"\r\n")
            assert all(len(line) <= 78 for line in lines)
            words = subject.removeprefix(b"Subject: ").split()
            if not row["subject"].isascii():
                assert all(re.fullmatch(rb"=\?UTF-8\?B\?[A-Za-z0-9+/]+=*\?=", word, flags=re.I)
                           and len(word) <= 75 for word in words)
                assert "".join(base64.b64decode(word.split(b"?")[3], validate=True).decode("utf-8") for word in words) == row["subject"]
                if len(row["subject"].encode("utf-8")) > 100:
                    assert len(lines) > 1
            body, attachment = list(msg.iter_parts())
            assert body.get_content_type() == "text/plain" and body.get_content_charset() == "utf-8"
            assert attachment.get_content_type() == "application/pdf" and attachment.is_attachment()
            assert attachment.get_filename() == row["filename"]
            for part in (body, attachment):
                assert str(part["Content-Transfer-Encoding"]).lower() == "base64"
                assert all(len(line) <= 76 for line in part.get_payload().splitlines())
            assert body.get_payload(decode=True).decode("utf-8") == re.sub(r"\r\n|\r|\n", "\r\n", row["body"])
            pdf = pdfs.read(entry["pdfZipPath"])
            assert attachment.get_payload(decode=True) == pdf
            assert digest(pdf) == entry["pdfSha256"] and digest(raw) == entry["emlSha256"]
            with fitz.open(stream=pdf, filetype="pdf") as doc:
                if flattened:
                    assert not doc.is_form_pdf
                    assert row["values"]["ID"] in doc[0].get_text()
                elif row.get("values"):
                    values = {widget.field_name: widget.field_value for page in doc for widget in page.widgets()}
                    assert all(values[name] == value for name, value in row["values"].items())
                    assert values["Sentinel"] == "KEEP 00109"
            fingerprints = custody["flattenedEntries" if flattened else "entries"]
            assert any(item["sha256"] == digest(pdf) and item["filename"] == row["filename"] and item["bytes"] == len(pdf)
                       for item in fingerprints)
            for prefix in spec.get("forbidden", []):
                # Hashes are opaque random hex, so a four-digit coincidence is not evidence of leaking a source value.
                exports = [entry["pdfZipPath"], entry["recipient"], attachment.get_filename(), str(msg["Subject"]), body.get_content()]
                assert all(prefix not in value for value in exports)
            proofs.append({"row": row["rowNumber"], "pdfSha256": digest(pdf), "emlSha256": digest(raw),
                           "subjectLines": len(lines), "attachmentBytes": len(pdf)})
        assert len({item["pdfSha256"] for item in proofs}) == len(rows)
        return proofs


if __name__ == "__main__":
    print(json.dumps(verify(json.load(sys.stdin))))
