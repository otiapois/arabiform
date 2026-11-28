# Milestone 27 (M27 / v2.7.0) — ArabiForm Batch PDF Fill Diff & Delta-Only Reprint Pack Auditor + 55,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.6.0` (Strict MENA/IBAN Roster Schema Validator, Offline `.eml` Dispatch & PII Redaction, 4-Up Print-Shop Pack, Template Diff & Preset Migrator, Conditional Field Rules, Multi-Template Packet Assembler, Offline CLI, 52,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **High-Waste Reprint & Audit Pain (`v2.7.0`)**: Organizations generate a 200-certificate or HR-letter batch on Monday, receive 7 spelling or ID corrections on Tuesday, re-run the batch, and face two expensive problems: (1) reprinting all 200 PDFs wastes 96% of the paper and print-shop time, and (2) compliance officers ask **"Which exact records and fields changed between Batch 1 and Batch 2?"** M27 adds a 100% browser-local **Batch PDF Fill Diff & Delta-Only Reprint Pack Auditor** (`Compare batches`) that compares Previous Export ZIP vs New Export ZIP by exact SHA-256 + AcroForm `/V` field values, classifies every PDF (`UNCHANGED`, `MODIFIED`, `ADDED`, `REMOVED`), shows exact `Old Value -> New Value` field diffs, and exports a **Delta-Only Reprint ZIP** (containing ONLY modified & added PDFs!) + **Batch Diff Audit CSV/JSON** + **Bilingual Delta Reprint Cover PDF** + `--mode diff-batch` CLI, reaching **55,000+ deterministic adversarial fuzz cases** (`v2.7.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`batch-pdf-diff-delta-reprint-55k-core`, worktree `wt-m27-core`)**:
   - **Pure Zero-DOM Batch PDF Diff & Delta Reprint Engine (`src/core/diff/batch-diff.ts`)**:
     - Accepts Previous Batch ZIP (`.zip` of PDFs) AND New Batch ZIP (`.zip` of PDFs), enforcing strict ZIP bomb / traversal / duplicate-entry / non-PDF guards!
     - Matches PDF members cleanly by normalized relative ZIP path (`folder/filename.pdf`), computes exact SHA-256 of both byte buffers, and classifies every member:
       - `unchanged` (exact SHA-256 byte equality — ZERO false positives!),
       - `modified` (SHA-256 differs -> inspects AcroForm `/V` text/checkbox/choice values on BOTH PDFs to list exact field-level `oldValue -> newValue` diffs, AND explicitly notes `visual-or-flattened-change` when PDFs are flattened without `/V`!),
       - `added` (present only in New Batch),
       - `removed` (present only in Previous Batch).
     - **Delta-Only Reprint Pack Builder**:
       - Emits **Delta Reprint ZIP** (`delta-reprint-pdfs.zip`) containing ONLY `modified` and `added` PDFs (preserving exact original relative subfolder paths & untouched PDF bytes — proven byte-identical to New Batch!),
       - Emits **Batch Diff Audit CSV & JSON** (`batch-diff-audit.csv` / `.json`, RFC 4180, formula-injection neutralized, SHA-256 custody hashes of BOTH input ZIPs and the Delta ZIP!),
       - Emits a 1-page **Bilingual Delta Reprint Summary PDF** (`delta-reprint-summary.pdf`, showing exact counts of Unchanged / Modified / Added / Removed + reprint sheet savings `%`!).
     - Wire into `scripts/arabiform-cli.ts` (`--mode diff-batch --previous <a.zip> --next <b.zip> --out-dir <dir>`, exit `0` clean diff / exit `2` malformed/unsafe ZIP!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 55,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving: (a) identical ZIPs always report `0` modified/added/removed and `100%` unchanged, (b) mutating 1 Arabic character or 1 checkbox in 1 PDF out of N produces a Delta Reprint ZIP containing ONLY that exact 1 modified PDF with exact field-level diff, (c) Delta ZIP member bytes equal New Batch member bytes bit-for-bit, and (d) traversal/corrupted ZIP entries fail closed!
   - **Strict Entry JS Budget**: Lazy-load Compare Batches UI & diff engine so initial entry JS stays strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes stay at `0` PDF/QR/font JS requests!

2. **Worker B (`batch-pdf-diff-ui`, worktree `wt-m27-web`)**:
   - **Lazy-Loaded `Compare batches` Utility Mode** (accessible cleanly from the secondary tools bar alongside `Compare templates` / `Assemble packets` / `Extract data`, bilingual EN & AR RTL, strictly 5 static routes, wrapping extension suffixes in `<bdi dir="ltr">` in Arabic!):
     - Drop Previous ZIP + New ZIP (or **1-click Synthetic Monday vs Tuesday Correction Demo**!) -> clear KPI strip (`Unchanged`, `Modified`, `Added`, `Removed`, `Reprint Savings %`) + filterable per-file field-diff table (`Old -> New`) + 1-click download (**Delta Reprint ZIP (.zip)**, **Diff Audit (.csv / .json)**, **Bilingual Delta Summary (.pdf)**)!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.7`, worktree `wt-m27-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.7.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 55,000 cases, 0 discarded; keep `>= 180_000 ms` timeouts on heavy fuzz tests!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying Bilingual Delta Reprint Summary PDF -> `0` clipping!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--mode diff-batch` (verifying exact Delta Reprint ZIP bytes & SHA-256 parity, plus exit `2` on corrupted/traversal ZIP!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M26 scenarios + M27 Batch PDF Diff, field-level `Old -> New` Arabic diff inspection, Delta-Only Reprint ZIP download & unpack verification, EN & `/ar/` RTL!
     - Save screenshots under `docs/reports/screenshots/m27/` (`desktop-m27-batch-diff-en.png`, `desktop-m27-batch-diff-ar.png`, `mobile-m27-batch-diff.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M27-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
