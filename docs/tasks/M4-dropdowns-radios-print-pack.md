# Milestone 4 (M4) — ArabiForm Dropdown & Radio Mapping, Print-Locked Flattened ZIP Option & Multi-Page Flag Navigation

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Accepted M3 (`1cfddc4`, 32/32 Vitest, 2,560 fuzz cases, PyMuPDF 4x 58/69 widgets 0-clipping, 32/32 real Edge E2E).
> **Product Objective**: Complete real-world Arabic/bilingual AcroForm coverage (text + checkbox + dropdown + radio group), add print-locked flattened individual PDFs inside ZIP (preventing mobile/macOS viewer font substitution bugs on shared Arabic certificates/forms), and add instant jump-to-flagged-page controls for multi-page templates.

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`dropdown-radio-flatten-core`, worktree `wt-m4-core`)**:
   - **Dropdown (`PDFDropdown`) & Radio Group (`PDFRadioGroup`) Mapping**:
     - Inspect available options cleanly at template intake (preserving exact option labels & export values, including Arabic/Unicode dropdown options!).
     - Allow mapping CSV/Excel columns to `PDFDropdown` and `PDFRadioGroup` fields with strict exact/trimmed option matching; **fail-closed** (`invalid-choice` diagnostic listing valid options!) when a roster cell does not match any legal option rather than silently dropping or picking option 0!
     - Keep unmapped dropdowns and radio groups 100% preserved bit-for-bit (`/V`, `/AS`, `/AP` untouched, verified at 4x PyMuPDF!).
     - Render custom/Unicode appearance streams cleanly for mapped Arabic dropdowns so PDF.js, Adobe, and PyMuPDF all display the selected Arabic option with 0 clipped ink pixels!
   - **Optional Print-Locked Flattened ZIP Mode (`flattenZip: boolean`, default `false`)**:
     - When enabled, flatten each individual PDF inside `Download Clean PDFs (.zip)` using the exact same appearance-preserving flatten path verified on Merged Printable PDFs (`0` interactive widgets left, `0` viewer font-substitution risk on iOS/macOS Preview/WhatsApp share!), while keeping default editable ZIP intact when `false`!
     - Verify 4x pixel identity between editable and flattened individual ZIP PDFs via PyMuPDF!
   - **Multi-Page Diagnostics & 4,000+ Fuzz**:
     - Expose the exact `pageNumbers: number[]` of failing widgets on each flagged row so multi-page forms can jump directly to the first failing page.
     - Expand synthetic fixtures (`fixtures/m4/multi-page-hr-choices.pdf`: 2-page bilingual HR/Clinic template with Arabic text + checkbox + Arabic/Latin dropdown + radio group + unmapped sentinel controls) verified at 4x PyMuPDF.
     - Expand `npm run test:fuzz` (deterministic seed) to **4,000+ total cases** covering dropdown/radio choice coercion, flattened ZIP output, custom fonts, checkboxes, filenames, and BiDi layout (0 crashes!).

2. **Worker B (`choices-flatten-multipage-ui`, worktree `wt-m4-web`)**:
   - **Dropdown & Radio Mapping UI**:
     - Upgrade `Contact [Radio buttons]` and `Clinic [Dropdown]` in Field Mapping from read-only `"Preserved untouched"` to full mappable dropdown selectors (defaulting to `"Leave unchanged"` so unmapped controls remain untouched by default!), displaying allowed choice chips on hover/diagnostic when a row is flagged for `invalid-choice`!
     - Inline row editor offers a clean `<select>` of legal options for mapped dropdown/radio fields (so fixing an invalid choice takes 1 click instead of typing!).
   - **Print-Locked Flattened ZIP Toggle**:
     - Add an explicit checkbox under Output Settings: **"Flatten individual PDFs in ZIP (lock fields for print/mobile sharing)"** (saved cleanly in backward-compatible JSON mapping presets, with both English and Arabic RTL copy!).
   - **Multi-Page Jump-to-Flagged-Page Control**:
     - When a flagged field sits on page `N > 1` (e.g. Page 2 of 2), selecting that row automatically jumps the live PDF preview to the first failing page AND displays clickable page-jump pills (`Page 2 · 1 issue`) right in the preview header!

3. **Worker C (`docs-ci-polish`, worktree `wt-m4-docs`)**:
   - Update bilingual `README.md`, `docs/subsystems/`, and `docs/launch/cloudflare-and-7day-plan.md` with dropdown/radio mapping and flattened-ZIP print sharing guidance (zero fake claims!).
   - Verify `.github/workflows/ci.yml` runs 4,000+ fuzz + typecheck + test + verify:pixels + build cleanly; keep strictly 5 static routes + `dist/_headers` (`connect-src 'none'`, `worker-src 'self'`, `form-action 'none'`).

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (4,000+ cases), `npm run verify:pixels` (PyMuPDF 4x across ALL M1–M4 templates including Arabic dropdown + radio + flattened ZIP pixel parity!), `npm run build`
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve all 32 M1–M3 Edge E2E scenarios
       - Add M4 Edge E2E scenarios:
         1. Multi-page mixed form (`multi-page-hr-choices.pdf`): map text + checkbox + dropdown + radio; invalid dropdown option on Page 2 auto-jumps preview to Page 2 with red highlight -> 1-click select valid option in inline editor -> flips Ready!
         2. Toggle **"Flatten individual PDFs in ZIP"** -> download ZIP -> verify every PDF inside has `0` interactive form widgets AND matches editable render pixel-for-pixel via PyMuPDF 4x!
         3. JSON mapping preset roundtrip preserves dropdown/radio mappings + `flattenZip` toggle cleanly while remaining backward-compatible with v1 presets!
         4. Assert **0 outbound requests**, **0 console errors**, **0 horizontal mobile overflow** on EN & AR RTL!
     - Save screenshots under `docs/reports/screenshots/m4/` (`desktop-m4-multipage-jump.png`, `desktop-m4-choices-ready.png`, `mobile-m4-choices.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` standards to `docs/code-standards.md`, clean up `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M4-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
