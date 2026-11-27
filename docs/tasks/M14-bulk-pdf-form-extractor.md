# Milestone 14 (M14 / v1.4.0) — ArabiForm Bulk Filled PDF Form Extractor (PDFs -> CSV / .xlsx Roundtrip) & 22,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.3.0` (`20,100` fuzz cases, multi-sheet `.xlsx` picker, A4 2-up print imposition with cut marks, local vector QR stamps, PyMuPDF 4× 0-clipping, entry JS `275.5 kB / 86.9 kB gzip`, `110/110` Edge E2E).
> **Bidirectional Workflow Upgrade (`v1.4.0`)**: Schools, clinics, HR teams, and government offices don't just *fill* Arabic/English AcroForm PDFs — they receive dozens or hundreds of *filled-in* PDF forms back by email and waste hours copy-pasting Arabic names, leading-zero IDs, checkboxes, and dropdowns into Excel! M14 adds a pure browser-local **Bulk PDF Form Extractor (`Extract PDFs -> CSV / .xlsx`)** supporting 1–200 filled AcroForm PDFs in one drop, with exact Arabic Unicode / harakat / leading-zero preservation, per-file SHA-256 chain-of-custody, formula-injection neutralization, and bit-for-bit `Fill -> Extract` roundtrip verification, plus **22,500+ adversarial fuzz cases** (`v1.4.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`bulk-pdf-extractor-22k-core`, worktree `wt-m14-core`)**:
   - **Pure Zero-DOM Bulk AcroForm Extractor (`src/core/extractor/extract.ts`)**:
     - Inspects an array of `1..200` uploaded `.pdf` byte arrays cleanly via `pdf-lib` (preserving full fail-closed intake guards: encrypted, XFA, digital-signature, and flat/no-AcroForm PDFs are flagged per file cleanly in a status column instead of crashing the batch!).
     - Extracts every AcroForm field across text fields (preserving Arabic UTF-16BE / PDFDocEncoding strings, full harakat/tashkeel, BiDi punctuation, and leading-zero IDs like `00123`), checkboxes (`checked` / `unchecked` with native export value), dropdowns, and radio groups.
     - Builds a deterministic union of field names across the uploaded batch (flagging schema mismatches when a PDF has missing/extra fields compared to the primary PDF!).
     - Computes per-file SHA-256 custody hashes (`sourceSha256`) alongside source filename and extraction status (`extracted` / `warning-schema-mismatch` / `blocked-flat` / `blocked-encrypted` / `blocked-xfa` / `blocked-signed`).
     - Exports 3 clean local artifacts:
       1. **Extracted CSV** (`arabiform-extracted.csv` — UTF-8 with BOM for Excel Arabic compatibility, RFC 4180 quoting, leading-zero safe, formula-injection neutralized)
       2. **Extracted Excel `.xlsx`** (`arabiform-extracted.xlsx` — string cells explicitly typed as text so Excel NEVER strips leading zeros like `00123`!)
       3. **Extraction Custody JSON** (`arabiform-extraction-audit.json` with SHA-256 hashes of every input PDF and the generated CSV/`.xlsx`).
     - Proves lossless roundtrip parity (`ArabiForm Fill -> Extracted CSV/.xlsx` reproduces 100% of Arabic names, harakat, leading-zero IDs, checkboxes, dropdowns, and radios!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 22,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic adversarial fuzz cases covering bulk PDF extraction, Arabic UTF-16BE + harakat roundtrips, leading-zero `.xlsx` cell encoding, formula-injection neutralization, mixed valid + corrupt/flat/encrypted PDFs in the same batch, and schema-mismatch warnings!
   - **Strict Entry JS Budget**: Dynamically `import()` the Extractor UI + engine so initial entry JS stays strictly BELOW `280 kB raw / 87.5 kB gzip` (`npm run verify:release` PASS) and idle EN & AR routes remain strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`bulk-pdf-extractor-ui`, worktree `wt-m14-web`)**:
   - **Lazy-Loaded `Extract filled PDFs` Mode Toggle on `/` and `/ar/`**:
     - Clean bilingual (EN + AR RTL) segmented mode switch inside the existing workspace: **`Fill PDFs` (default)** | **`Extract PDFs -> CSV / .xlsx`** (preserving strictly 5 static routes in `sitemap.xml` and keeping default `Fill PDFs` 100% unchanged!).
     - Multi-file PDF dropzone (`1..200` PDFs) + **1-click synthetic Arabic Filled-PDFs Demo** (dynamically generates 3 filled bilingual AcroForm PDFs locally and extracts them live!) -> live extracted table with status badges, schema-mismatch warnings, SHA-256 custody badges, and 1-click downloads (**CSV**, **`.xlsx`**, **Custody JSON**).
   - Keep `0` outbound requests, `0` console errors, `0` horizontal mobile overflow at `390px`, `0` idle PDF/font JS requests, and WCAG AA contrast!

3. **Worker C (`release-docs-v1.4`, worktree `wt-m14-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.4.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin test), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 22,500 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× `0` clipping), `npm run build`, `npm run verify:release` (entry JS `< 280 kB raw / < 87.5 kB gzip`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M13 Edge E2E scenarios (110 existing scenarios!)
       - Add M14 Edge E2E scenarios:
         1. Full `Fill -> Extract` live browser roundtrip: batch-fill Arabic/harakat/leading-zero/checkbox/dropdown PDFs -> switch to **`Extract PDFs -> CSV / .xlsx`** -> drop the filled PDFs + 1 flat PDF -> verify extracted Arabic names, leading-zero IDs, checkbox/dropdown values, flat-PDF fail-closed badge, downloaded CSV & `.xlsx` exact cell values, and SHA-256 custody parity!
         2. Test `/ar/` RTL Extractor mode + 1-click synthetic demo + verify `0` outbound requests, `0` console errors, `0` idle PDF/font JS requests, and `0` horizontal mobile overflow at `390px`!
     - Save screenshots under `docs/reports/screenshots/m14/` (`desktop-m14-extractor-en.png`, `desktop-m14-extractor-ar.png`, `mobile-m14-extractor.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M14-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
