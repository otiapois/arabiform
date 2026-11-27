# Milestone 15 (M15 / v1.5.0) — ArabiForm Visual Flat-PDF AcroForm Field Designer (No Acrobat Needed!) & 25,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.4.0` (Bulk Filled PDF Extractor, Multi-Sheet `.xlsx` Picker, 2-Up Print Imposition, Vector QR Stamps, 22,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 280 kB / 87.5 kB gzip`).
> **TAM-Multiplying Commercial Breakthrough (`v1.5.0`)**: Until now, ArabiForm rejected flat/non-interactive PDFs (like Canva Arabic certificates, Word exports, or clinic letterhead PDFs) because users had to buy Adobe Acrobat Pro first just to draw AcroForm fields! M15 turns that exact blocker into a superpower: a pure browser-local **Visual Flat-PDF AcroForm Field Designer** where users click-and-drag standard PDF text & checkbox fields right onto ANY flat PDF page, configure field name, alignment (`Auto/RTL/LTR/Center`), font size, multiline, and `/MaxLen`, download a **reusable standard AcroForm `.pdf` template**, AND immediately send it into ArabiForm's full ink-bounds preflight + batch-fill studio in one click! Plus **25,000+ deterministic adversarial fuzz cases** (`v1.5.0`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`flat-pdf-acroform-designer-25k-core`, worktree `wt-m15-core`)**:
   - **Pure Zero-DOM AcroForm Authoring Engine (`src/core/designer/author.ts`)**:
     - Takes any flat (non-encrypted, non-signed, non-XFA) `.pdf` byte array + a validated list of user-placed `FieldDraftSpec[]`:
       - `{ name, kind: 'text' | 'checkbox', pageIndex, rectPdf: [x, y, width, height], alignment?: 'auto'|'rtl'|'ltr'|'center', multiline?: boolean, maxLen?: number, fontSize?: number }`
     - Validates every spec fail-closed: unique non-empty field names (rejecting duplicates or PDF dot-path collisions cleanly), strictly inside page `CropBox`/`MediaBox` bounds (clamping/rejecting out-of-bounds rects with exact coordinates!), minimum readable box size, and exact conversion between normalized canvas viewport coordinates (handling rotated `0°/90°/180°/270°` pages!) and standard PDF user-space coordinates!
     - Writes real ISO 32000 AcroForm widgets cleanly via `pdf-lib` (preserving original flat page graphics untouched!), producing a standard `.pdf` template that:
       1. Passes `inspectTemplate()` immediately as a valid AcroForm PDF with exact field count, types, rects, `/MaxLen`, and flags!
       2. Batch-fills with Arabic + harakat + English + checkboxes through ArabiForm's full ink-bounds preflight, custom fonts, QR stamps, and 2-up imposition!
       3. Verifies via PyMuPDF 4× (`scripts/verify-pdf-pixels.py`): `0` clipped ink, `0` outside-box ink, crisp visible Arabic glyphs aligned inside the user-drawn rectangles, and readable `/V` values via M14 Extractor!
     - Supports saving/loading reusable **Field Layout JSON** (with SHA-256 binding to source flat PDF) so teams can tweak box positions later without redrawing!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 25,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases covering coordinate transforms across `0°/90°/180°/270°` rotated pages, bounds clamping, duplicate-name rejection, `Author -> Inspect -> Fill -> Extract` full 4-stage Arabic roundtrips, and layout JSON roundtrips!
   - **Strict Entry JS Budget**: Dynamically `import()` the Visual Field Designer canvas & authoring engine so initial entry JS remains strictly BELOW `280 kB raw / 87.5 kB gzip` (`npm run verify:release` PASS) and idle EN & AR routes stay strictly at `0` PDF/QR/font JS requests!

2. **Worker B (`flat-pdf-designer-ui`, worktree `wt-m15-web`)**:
   - **Lazy-Loaded `Design form fields` Mode + Inline Flat-PDF Recovery CTA on `/` and `/ar/`**:
     - Add **`Design fields`** as a clean third mode tab (`Fill PDFs` | `Extract PDFs` | `Design fields`) — strictly 5 static routes in `sitemap.xml`, keeping `Fill PDFs` default 100% unchanged!
     - **Frictionless Conversion Hook**: When a user drops a flat PDF into **`Fill PDFs`**, keep the honest fail-closed flat-PDF intake banner AND add a 1-click button **"Open in Visual Field Designer"** right on the alert so users convert their flat PDF in 15 seconds instead of bouncing!
     - Interactive canvas UI (bilingual EN + AR RTL):
       - Drag to place `Text field` or `Checkbox` boxes (plus click-to-select, keyboard arrow nudge `1pt` / Shift+arrow `5pt`, resize/numeric `X/Y/W/H` inputs for exact print precision, page switcher, delete, and undo!).
       - Inspector sidebar for selected field (`Field name`, `Kind`, `Alignment`, `Multiline`, `Max length`).
       - 2 prominent actions: **"Download AcroForm Template (.pdf)"** AND **"Use in Fill PDFs Now"** (immediately hands the authored AcroForm bytes straight into `Fill PDFs`!).
       - Include a **1-click synthetic Flat Certificate Demo** so evaluators can try drawing & batch-filling in seconds!
   - Keep `0` outbound requests, `0` console errors, `0` horizontal mobile overflow at `390px`, `0` idle PDF/font JS requests, and WCAG AA contrast!

3. **Worker C (`release-docs-v1.5`, worktree `wt-m15-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `1.5.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin test), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 25,000 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× including authored flat-PDF template filled with Arabic + harakat + checkbox -> `0` clipping, `0` outside-box ink!), `npm run build`, `npm run verify:release` (entry JS `< 280 kB raw / < 87.5 kB gzip`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve 100% of M1–M14 Edge E2E scenarios
       - Add M15 Edge E2E scenarios:
         1. Drop `fixtures/golden/flat.pdf` into **`Fill PDFs`** -> verify fail-closed flat-PDF intake guard AND click **"Open in Visual Field Designer"** -> draw/place an Arabic `Name` text field + `Verified` checkbox -> click **"Use in Fill PDFs Now"** -> batch-fill with Arabic + harakat roster -> download Filled PDF -> verify via M14 Extractor that exact Arabic name & checkbox state read back 100% intact!
         2. Test `/ar/` RTL Field Designer mode + Download reusable AcroForm `.pdf` template + verify `0` outbound requests, `0` console errors, `0` idle PDF/font JS requests, and `0` horizontal mobile overflow at `390px`!
     - Save screenshots under `docs/reports/screenshots/m15/` (`desktop-m15-designer-en.png`, `desktop-m15-designer-ar.png`, `desktop-m15-flat-to-fill.png`, `mobile-m15-designer.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M15-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
