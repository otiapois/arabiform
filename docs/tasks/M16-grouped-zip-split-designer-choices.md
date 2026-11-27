# Milestone 16 (M16 / v1.6.0) — ArabiForm Grouped ZIP Subfolders, Split Per-Group Merged Print Packs, Designer Dropdown/Radio Authoring & 27,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.5.0` (`66615c3`, 160/160 Vitest, 25,160 fuzz cases, PyMuPDF 4× 49 fills / 0 clipping, entry JS `274.3 kB / 86.3 kB gzip`, 122/122 real Edge E2E).
> **Enterprise Print-Ops Upgrade (`v1.6.0`)**: HR departments, multi-branch clinics, and school districts batch-filling 100–500 Arabic/English PDFs rarely want one flat folder — they need outputs automatically organized **by a roster grouping column** (e.g. `Department` or `Branch`: `Riyadh_Clinic/00123.pdf` or per-branch merged printable PDFs each with its own bilingual Cover Sheet!), AND teams building templates in the M15 Visual Field Designer also need standard **Dropdown** and **Radio group** controls on flat PDFs. M16 delivers both plus **27,500+ deterministic adversarial fuzz cases** (`v1.6.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`grouped-export-designer-choices-27k-core`, worktree `wt-m16-core`)**:
   - **Grouped ZIP Subfolder & Per-Group Split Merged PDF Engine (`src/core/export/grouping.ts`)**:
     - Optional `groupByColumn` selector (default `none`, keeping 100% of existing flat ZIP & single Merged PDF behavior unchanged!).
     - Deterministic safe folder-name sanitization preserving Arabic & Latin letters while neutralizing path traversal (`..`, `/`, `\`), Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`), trailing dots/spaces, and blank values (routed to explicit `_Ungrouped` folder with disclosure!).
     - Supports TWO real grouped export modes:
       1. **Grouped Individual PDFs ZIP**: places each ready PDF into `<SafeGroup>/<SafeFilename>.pdf` with deterministic collision suffixes per folder, plus exact `zipPath` recorded in CSV/JSON diagnostics & SHA-256 Custody Manifest!
       2. **Split Per-Group Merged Printable PDFs ZIP**: creates one Merged Printable PDF per group (`<SafeGroup>-merged.pdf`, honoring Print Watermark, Local Vector QR Stamp, A4 `2-up` imposition, and each group's own accurate Bilingual Cover Sheet page index!) plus a root batch custody manifest (`batch-custody.json`)!
     - Persists `groupByColumn` cleanly in v9 JSON presets (100% backward-compatible with v1–v8!).
   - **Visual Field Designer Dropdown & Radio Group Authoring (`src/core/designer/author.ts`)**:
     - Extend `FieldDraftSpec` cleanly to support `kind: 'dropdown'` (with validated non-empty unique `options: string[]`) and `kind: 'radio'` (named radio group sharing a `fieldName` with distinct `exportValue` per placed button widget!).
     - Writes standard ISO 32000 `/FT /Ch` (combo dropdown with `/Opt`) and `/FT /Btn` (radio group with explicit `/Off` + export states) cleanly via `pdf-lib`, passing `inspectTemplate()`, full Arabic/English Fill preflight, PyMuPDF 4× pixel proof (`0` clipping, `0` outside-box ink), and M14 Bulk Extractor roundtrip!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 27,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases testing adversarial group folder names (traversal, Unicode BiDi, Windows reserved names, collisions), per-group split merged PDF page-index conservation, authored Dropdown/Radio `Design -> Inspect -> Fill -> Extract` roundtrips, and v1–v9 preset compatibility!
   - **Strict Entry JS Budget**: Lazy-load new M16 UI/engines so initial entry JS remains strictly BELOW `278 kB raw / 87.0 kB gzip` (`npm run verify:release` PASS) and idle EN & AR routes remain strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`grouped-export-and-designer-choices-ui`, worktree `wt-m16-web`)**:
   - **Group Outputs Control** under Output Settings (`Group files by column`: `None (single folder)` default or any roster column, plus clean **"Download Split Merged PDFs by Group (.zip)"** button when a grouping column is active, bilingual EN & AR RTL!).
   - **Designer Dropdown & Radio Tools**: Add `Dropdown` and `Radio` placement buttons & option editor inside the lazy-loaded **`Design fields`** inspector (preserving `Text field` & `Checkbox` defaults cleanly!).
   - Keep strictly 5 static routes, `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v1.6`, worktree `wt-m16-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.6.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin test), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 27,500 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× including authored flat-PDF dropdown & radio widgets filled with Arabic/English choices -> `0` clipping, `0` outside-box ink!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 278 kB / 87.0 kB gzip`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M15 Edge E2E scenarios (122 existing scenarios!)
       - Add M16 Edge E2E scenarios:
         1. Group a multi-branch bilingual roster by `Clinic` -> download **Grouped ZIP** AND **Split Merged PDFs by Group (.zip)** -> unpack and verify safe subfolder paths, exact per-group PDF counts & cover-sheet page ranges, and SHA-256 custody parity!
         2. In **`Design fields`**, place a `Dropdown` (`RIY`, `JED`) and `Radio` pair (`CALL`, `MAIL`) on a flat PDF -> click **"Use in Fill PDFs Now"** -> fill with Arabic/English roster -> extract via M14 Extractor and assert exact choice & radio values roundtrip cleanly!
         3. Verify v9 preset roundtrip + v1–v8 compatibility, `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` mobile overflow at `390px`!
     - Save screenshots under `docs/reports/screenshots/m16/` (`desktop-m16-grouped-export.png`, `desktop-m16-designer-choices.png`, `mobile-m16-grouped.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M16-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
