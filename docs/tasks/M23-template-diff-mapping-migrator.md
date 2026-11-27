# Milestone 23 (M23 / v2.3.0) — ArabiForm AcroForm Template Version Diff & Safe Preset Migrator + 45,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.2.0` (Conditional Field Rules, Multi-Template Batch Packet Assembler, Arabic Numeral Policy & Official Vector Seal, Live Row Compare, Print Estimator, Offline CLI, 42,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **Annual Institutional Maintenance Pain (`v2.3.0`)**: Every year ministries, universities, HR departments, and clinics publish a revised AcroForm template (`2027-Offer.pdf` replacing `2026-Offer.pdf`) where a few fields were renamed (`FullName` -> `EmployeeFullName`), a box narrowed by 22 pt, `/MaxLen` shrank from `40` to `28`, or a dropdown option changed — silently breaking teams' saved presets or causing late-night print clipping! M23 adds a 100% browser-local **Template Version Diff & Safe Preset Migrator** (`Compare templates`) that inspects Old vs New AcroForm PDFs (plus an optional v1–v11 Preset JSON), reports every added/removed/resized/option-changed field with exact `pt` geometry deltas, lets operators safely remap removed fields to new field names, and exports a verified **Migrated Preset (.json)** + **Template Migration Report (.csv/.json)** + `--mode diff-template` CLI, reaching **45,000+ deterministic adversarial fuzz cases** (`v2.3.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`template-diff-migrator-45k-core`, worktree `wt-m23-core`)**:
   - **Pure Zero-DOM Template Diff & Preset Migrator Engine (`src/core/template/diff-migrator.ts`)**:
     - Parses two AcroForm PDFs (`oldTemplate` & `newTemplate`, passing ArabiForm's full fail-closed intake guards rejecting XFA/encrypted/signed/flat PDFs cleanly!) and computes deterministic field-by-field structural diff:
       - `addedFields`, `removedFields`, `typeChangedFields` (e.g. text -> choice), `geometryChangedFields` (exact `oldWidthPt`, `newWidthPt`, `widthDeltaPt`, `oldHeightPt`, `newHeightPt`, `heightDeltaPt`, highlighting **Shrunk Boxes** as clipping-risk warnings!),
       - `maxLenChangedFields` (flagging `/MaxLen` reductions!),
       - `choiceOptionsChangedFields` (added/removed dropdown `/Opt` values or radio export states!).
     - **Deterministic Preset Migration**:
       - Accepts an existing `v1..v11` ArabiForm Preset JSON + explicit operator rename map (`oldFieldName -> newFieldName`).
       - Fail-closed if a target field does not exist in `newTemplate`, has an incompatible widget type (`text` mapped to `checkbox`), collides with another mapped field, or references a removed dropdown option inside a conditional rule!
       - Rewrites field mappings, per-field alignment/numeral/typography overrides, and conditional rules cleanly onto `newTemplate` while preserving all unaffected settings, emitting a valid **Migrated Preset JSON** + **Migration Audit Report (CSV & JSON)** with SHA-256 fingerprints of both old & new templates!
     - Wire into `scripts/arabiform-cli.ts` (`--mode diff-template --old <a.pdf> --new <b.pdf> [--preset <p.json>]`, exit `0` compatible / exit `2` breaking changes or unmapped preset fields!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 45,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases testing identical-template zero-diff invariance, geometry shrink detection across rotated/cropped pages, `/MaxLen` & `/Opt` diff completeness, fail-closed incompatible rename rejection, and migrated preset roundtrip validity!
   - **Strict Entry JS Budget**: Lazy-load Template Diff UI & engine so initial entry JS stays strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes stay at `0` PDF/QR/font JS requests!

2. **Worker B (`template-diff-migrator-ui`, worktree `wt-m23-web`)**:
   - **Lazy-Loaded `Compare templates` Utility Mode** (accessible cleanly from the secondary tools bar alongside `Extract data` / `Design fields` / `Verify receipt` / `Assemble packets`, bilingual EN & AR RTL, strictly 5 static routes!):
     - Drop Old PDF + New PDF + optional existing Preset JSON (or **1-click Synthetic 2026 -> 2027 Template Upgrade Demo**!) -> clear summary cards (`Added`, `Removed`, `Shrunk boxes`, `Option changes`) + interactive rename dropdowns for removed preset fields + 1-click download **Migrated Preset (.json)**, **Migration Report (.csv / .json)**, or **Open New Template & Migrated Preset directly in Fill PDFs**!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.3`, worktree `wt-m23-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.3.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 45,000 cases, 0 discarded; keep `>= 180_000 ms` timeouts on large fuzz tests!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying a batch filled using the newly migrated preset on the revised 2027 template -> `0` clipping!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--mode diff-template` (exit `0` non-breaking + exit `2` breaking shrink/removed field!).
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M22 scenarios + M23 Template Diff, shrunk-box warning, preset rename migration -> direct handoff into `Fill PDFs`, EN & `/ar/` RTL, `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m23/` (`desktop-m23-template-diff-en.png`, `desktop-m23-template-diff-ar.png`, `mobile-m23-template-diff.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M23-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
