# Milestone 3 (M3) — ArabiForm Mixed-Widget Compatibility, Checkbox Mapping, Local Custom Font Upload & BiDi Filename Fix

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Accepted M2 (`2c04e37`, 23/23 Vitest, 1,160 fuzz cases, PyMuPDF 4x 49 ink-bearing widgets 0-clipping, 22/22 Edge E2E).
> **Product Objective**: Unlock real-world HR/clinic/government/certificate AcroForm templates (which combine text fields + checkboxes/radios/dropdowns and branded corporate Arabic fonts) while fixing the M2 visual filename BiDi P2 (`pdf.ليلى حسن-00001` -> `00001-ليلى حسن.pdf`).

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`mixed-widgets-custom-font-core`, worktree `wt-m3-core`)**:
   - **Mixed-Widget AcroForm Preservation + Optional Checkbox Mapping**:
     - Ensure PDFs combining `PDFTextField` with `PDFCheckBox`, `PDFRadioGroup`, and `PDFDropdown` load cleanly without error.
     - Preserve ALL unmapped checkboxes, radio groups, and dropdowns bit-for-bit (`/V`, `/AS`, `/AP` intact; 0 pixel diff outside mapped widgets verified at 4x via PyMuPDF!).
     - Support mapping CSV/Excel columns to `PDFCheckBox` fields (`true/false`, `yes/no`, `1/0`, `x/""`, `نعم/لا`, case-insensitive & trimmed); fail-closed (flag row with clear diagnostic!) on unrecognized values rather than silently unchecking.
   - **Local Custom Font (`.ttf` / `.otf`) Support**:
     - Allow supplying a user-uploaded local TTF/OTF `Uint8Array` into the PDF core engine & Web Worker.
     - Validate font header/parseability via `@pdf-lib/fontkit` AND verify required glyph coverage before rendering (if a custom font lacks glyphs for Arabic text in a field, flag the field clearly as `missing-glyphs` instead of silently outputting `.notdef` tofu boxes!).
   - **Excel `.xlsx` Formula Cell Warning**:
     - Surface explicit source warning when a mapped `.xlsx` cell contains a spreadsheet formula (`<f>`) without/with cached value so teams catch stale calculated values before printing PDFs.
   - **Expanded Golden Fixtures + 2,500+ Case Fuzzing**:
     - Add synthetic mixed-widget template (`fixtures/m3/clinic-consent-mixed.pdf` containing Arabic/Latin text fields + pre-checked unmapped checkbox + mapped checkbox + preserved dropdown + sentinel `KEEP 00109`) verified by `scripts/verify-pdf-pixels.py` (4x 0 clipped ink pixels, 0 changes on unmapped checkbox/dropdown!).
     - Expand `npm run test:fuzz` (deterministic seed) to **2,500+ total cases** covering checkbox parsing, custom font rejection/missing-glyph detection, filename sanitization, and BiDi layout with 0 crashes!

2. **Worker B (`bidi-filename-font-ui`, worktree `wt-m3-web`)**:
   - **Fix M2 Visual P2 — Mixed Arabic/Latin Filename Display**:
     - Render every filename in the Preflight Queue and selected row summary inside an LTR container (`<bdi dir="ltr">` with isolated stem segments) so `00001-ليلى حسن.pdf` and `AR-00042-ق-سَلْمَى بِنْت يَاسِين.pdf` ALWAYS display visually left-to-right with `.pdf` at the right end on BOTH English LTR and Arabic RTL pages!
   - **Checkbox Mapping & Custom Font UI**:
     - Show checkbox fields clearly tagged (`Checkbox`) in the Field Mapping panel alongside text fields, including clear status for unmapped non-text fields ("preserved untouched").
     - Add **"Custom font (.ttf / .otf)"** local file picker under Output Settings (with Clear button, loaded font family name + glyph check feedback, and explicit "stays in this browser tab" note; works cleanly inside both English and Arabic RTL UI!).
     - Update JSON mapping presets (`version: 1` backward-compatible or cleanly versioned with v1 migration!) to preserve checkbox mappings safely while keeping custom font bytes local-only (never bloating JSON presets with megabyte font binaries).

3. **Worker C (`docs-deploy-launch`, worktree `wt-m3-docs`)**:
   - Update `.github/workflows/ci.yml` if needed (verify `npm run test:fuzz` 2,500+ cases runs fast & green in CI), sync `THIRD_PARTY_NOTICES.md`, keep strictly 5 static routes + `dist/_headers` (`connect-src 'none'`, `worker-src 'self'`, `form-action 'none'`).
   - Update bilingual `README.md` with M3 capabilities (checkbox mapping, mixed-widget preservation, local custom TTF/OTF font upload) and updated screenshots.
   - Create `docs/launch/cloudflare-and-7day-plan.md`: exact Cloudflare Pages deployment checklist (`SITE_URL`, build command, `dist`, `_headers` verification) + factual 7-day non-SEO validation checklist (zero unverified claims).

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`
     - `npm test` (0 regression on M1+M2 + all new M3 tests)
     - `npm run test:fuzz` (2,500+ cases, 0 crashes)
     - `npm run verify:pixels` (PyMuPDF 4x across ALL M1+M2+M3 templates including mixed-widget consent form + custom font render: 0 clipped ink pixels, 0 outside changes)
     - `npm run build` (strictly 5 static routes + `_headers`)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve all 22 M1+M2 Edge E2E scenarios
       - Add M3 Edge E2E scenarios:
         1. **Mixed-widget consent PDF** (`fixtures/m3/clinic-consent-mixed.pdf`): map Arabic text + checkbox (`نعم`/`لا`/invalid value -> fail-closed flag -> inline fix -> ready), verify downloaded PDF keeps unmapped checkbox/dropdown intact via `pdf-lib` & PyMuPDF!
         2. **Custom local font upload**: upload local `NotoSans-Regular.ttf` (Latin-only) against Arabic text -> verify fail-closed `missing-glyphs` flag (no tofu!); upload local `NotoNaskhArabic-Regular.ttf` -> verify clean render & download; upload corrupt `.ttf` -> verify fail-closed error!
         3. **Filename BiDi visual order check**: assert `00001-ليلى حسن.pdf` renders with `dir="ltr"` and `.pdf` suffix positioned at the right visual edge on BOTH `/` and `/ar/pdf-mail-merge`!
         4. Assert **0 outbound requests**, **0 console errors**, **0 horizontal mobile overflow**!
     - Save updated screenshots under `docs/reports/screenshots/m3/` (`desktop-m3-mixed-widgets.png`, `desktop-m3-custom-font.png`, `desktop-m3-ltr-filenames.png`, `desktop-m3-ar-rtl-filenames.png`, `mobile-m3-mixed.png`).
     - Update `LESSONS.md` (promote any `Seen >= 3` rules into `docs/code-standards.md`), clean up `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M3-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
