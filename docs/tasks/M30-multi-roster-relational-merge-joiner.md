# Milestone 30 (M30 / v3.0.0) — ArabiForm Multi-Roster Relational Lookup Joiner (Primary Roster + Secondary Department/Signatory Table) + 62,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.9.0` (Monochrome DeviceGray Proofer, Bilingual Vector Seal Library, Batch PDF Diff & Delta Reprint, MENA/EU IBAN Roster Validator, Offline `.eml` Dispatch & PII Redaction, 4-Up Print-Shop Pack, 60,000+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **Major `v3.0.0` Enterprise HR / University / Clinic Workflow**: Real institutional mail-merges rarely live in one flat spreadsheet — HR exports `employees.csv` (with `DeptCode`) while branch managers, Arabic department titles, and authorized signatory names live in a separate `departments.csv` or `.xlsx`! Manually doing Excel `VLOOKUP` destroys Arabic UTF-8 encoding and strips leading-zero employee IDs! M30 adds a 100% browser-local **Relational Lookup Joiner** that performs exact-key, zero-mutation left joins in memory BEFORE AcroForm mapping, with fail-closed duplicate-lookup-key and missing-lookup-key guards, SHA-256 fingerprinting of BOTH source files in `custody-manifest.json`, `--lookup-table` & `--join-key` CLI flags, and **62,500+ deterministic adversarial fuzz cases** (`v3.0.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`relational-roster-joiner-62k-core`, worktree `wt-m30-core`)**:
   - **Pure Zero-DOM Relational Roster Lookup Joiner (`src/core/roster/lookup-join.ts`)**:
     - Joins a **Primary Roster** (CSV or XLSX visible sheet) with a **Secondary Lookup Table** (CSV or XLSX visible sheet) on an explicit `(primaryKeyColumn, lookupKeyColumn)` pair using exact string equality (optional explicit `trimWhitespace: false` default, strictly preserving leading zeros like `001` vs `1` so `001` NEVER collides with `1`!).
     - Prefixes joined columns deterministically (`<lookupPrefix>.<Column>` or collision-free explicit naming) so joined columns NEVER silently overwrite primary roster headers!
     - **Fail-Closed Referential Integrity Guards**:
       - **Blocks (`HOLD`)** if the Secondary Lookup Table contains **duplicate join keys** (reporting exact duplicate key & physical row numbers — eliminating silent VLOOKUP first-match errors!).
       - **Unmatched Primary Key Policy**: default `'block-unmatched'` (flags/blocks any primary row whose join key is missing from the lookup table with exact row number & key!) or explicit `'allow-blank'` (leaves joined fields blank and stamps `unmatchedKeysCount` in preflight audit!).
       - Records BOTH `rosterSha256` AND `lookupTableSha256` (plus exact worksheet names when XLSX) in `custody-manifest.json` and Print-Shop Certificates!
     - Wires `--lookup-table <csv|xlsx>`, `--lookup-sheet`, `--join-primary-key`, `--join-lookup-key`, and `--allow-unmatched-lookup` into `scripts/arabiform-cli.ts` (`preflight`, `fill`, and `packet` modes!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 62,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving: (a) leading-zero keys (`007` vs `7`) stay strictly distinct, (b) duplicate lookup keys ALWAYS fail closed, (c) primary columns are NEVER mutated or shadowed by lookup columns, and (d) Arabic/Unicode keys join identically across CSV and XLSX! Keep heavy fuzz timeouts `>= 180_000 ms`.
   - **Strict Entry JS Budget**: Lazy-load Lookup Joiner UI so largest entry JS stays `< 274 kB raw / 85.8 kB gzip` and idle routes stay at `0` PDF/QR/font JS!

2. **Worker B (`relational-joiner-ui`, worktree `wt-m30-web`)**:
   - **Lazy-Loaded `Attach lookup table (CSV/XLSX)` Drawer** inside Roster Intake (EN & `/ar/` RTL, strictly 5 routes, `<bdi dir="ltr">` on file extensions in Arabic buttons):
     - Upload secondary lookup CSV/XLSX + pick Primary Key & Lookup Key + **1-click Synthetic Bilingual HR Employees + Departments Lookup Demo** -> live join match rate badge + duplicate/unmatched row alerts -> joined columns immediately appear in the AcroForm Field Mapper!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v3.0`, worktree `wt-m30-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `3.0.0`, update bilingual `CHANGELOG.md`, `README.md` (cleanly highlighting v3.0.0 capabilities with zero unverified claims!), `docs/subsystems/roster-mapper.md`, and `docs/subsystems/cli-automation.md`.
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `fixtures/.gitattributes` wildcard rules intact!

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 62,500 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying Arabic signatory + department joined fields render unclipped with exact SHA-256!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--mode fill --lookup-table ...` (exit `0` clean join with BOTH file digests in `custody-manifest.json` + exit `2` duplicate lookup key fail-closed with `0` PDFs written!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M29 scenarios + M30 synthetic HR+Departments lookup join, duplicate-key hold check, and EN + `/ar/` RTL verification!
     - Save screenshots under `docs/reports/screenshots/m30/` (`desktop-m30-lookup-join-en.png`, `desktop-m30-lookup-join-ar.png`, `mobile-m30-lookup-join.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M30-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
