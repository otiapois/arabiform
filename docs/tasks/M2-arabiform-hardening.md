# Milestone 2 (M2) — ArabiForm Web Worker Scale, BiDi/Fuzz Hardening & Editorial UX Polish

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Accepted M1 `e6094dc` (`v0.1.0`, 11/11 Vitest, PyMuPDF 4x 0-clipping, 12/12 Edge E2E).
> **Competitive Objective**: Sharpen our verifiable advantages over free/paid alternatives (`EasyArchive`, `Waraq`, `JustFill`, `BulkPDF`): non-blocking Web Worker batch engine (200+ rows), zero-clipping ink-BBox diagnostics with exact font-size delta & 1-click safe fix, mixed BiDi hardening, zip-slip / formula-safe fuzzing, portable JSON mapping presets, and verifiable `CSP: connect-src 'none'`.

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`perf-worker-bidi-fuzz`, worktree `wt-m2-core`)**:
   - **Local Web Worker Batch Engine** (`src/core/worker/batch.worker.ts` + clean typed RPC wrapper, bundled locally under `worker-src 'self'` with 0 CDN):
     - Offload batch preflight, ZIP generation, and Merged Printable PDF generation off the main UI thread.
     - Emit live row-by-row progress events (`completed / total`, phase) and support clean cancellation (`Cancel batch`) without stale results overwriting newer state!
   - **BiDi, Diagnostics & Template Stress Expansion**:
     - Deepen mixed Arabic + Latin + digits + punctuation handling (`الطلب #00123 - Riyadh 2026`, `(أحمد - 0045)`, `+966 50 012 3456`, Arabic-Indic digits `٠١٢٣٤٥`) while keeping canonical `/V` exact and visually unclipped.
     - Emit actionable overflow metrics on every flagged field: `requiredFontSizePt` (when shrinking within `>= 6pt` would fit) or `maxLengthExcess` so the UI can show exact guidance.
     - Harden output filename sanitization against path traversal / zip-slip (`../`, `..\\`, leading `/`, Windows reserved device names `CON`/`PRN`/`AUX`/`NUL`/`COM1`, duplicate collision deduplication `-2`, `-3`).
     - Expand offline golden fixture generator with **8+ additional realistic synthetic AcroForm templates** (HR onboarding, clinic intake, bilingual certificate, landscape rotated badge, narrow `MaxLen` comb/code field, multi-page repeated header widget, multiline address box with explicit `\n` breaks) + verify ALL via PyMuPDF 4x `scripts/verify-pdf-pixels.py` (0 clipped ink pixels, 0 out-of-bounds pixel diff).
   - **Adversarial Property Fuzzing (`npm run test:fuzz`)**:
     - Install MIT `fast-check` (exact pinned version, add notice to `THIRD_PARTY_NOTICES.md`).
     - Write deterministic-seed fuzz suite (`tests/core/fuzz.test.ts`, 1,000+ generated cases) hitting roster parsing, filename sanitization, BiDi layout, and AcroForm filling with random Arabic harakat stacks, ZWJ/ZWNJ, RTL/LTR isolate marks, emojis, control chars, CSV formula prefixes, 500-char strings, and weird leading-zero numbers: assert **0 uncaught crashes**, **0 zip-slip paths**, and **100% fail-closed or clean fit**.

2. **Worker B (`ux-polish-presets`, worktree `wt-m2-web`)**:
   - **Fix BOTH M1 P2s cleanly**:
     1. Isolate mixed Arabic+Latin filenames with `<bdi dir="auto">` so prefixes like `AR-00042-ق-سَلْمَى بِنْت يَاسِين.pdf` never visually jumble punctuation.
     2. Display exact overflow diagnostics (`Needs 6.8 pt (min is 8 pt)` or `Exceeds MaxLen by 6 chars`) next to the red highlight banner and in the selected row editor, PLUS a 1-click **"Set min font to X pt"** helper button whenever lowering min font size within `>= 6 pt` resolves the overflow!
   - **200-Row Responsive Queue & Worker Progress UI**:
     - Wire the Web Worker batch engine with a crisp live progress indicator + `Cancel` button.
     - Upgrade Preflight Queue for 200+ rows: instant search filter (by row number / filename / value), filter chips (`All`, `Ready`, `Flagged`, `Source warnings`), and smooth windowed/paginated rendering with zero jank on desktop & mobile.
   - **Portable Local Mapping Presets (`.json` Export / Import)**:
     - Allow teams to save & reload their PDF field mapping + filename template + minimum font size + font mode as a clean local `.json` preset (validate schema fail-closed on import, surface warning if preset references fields missing from the current PDF).
   - **Honest Visual Explainer**:
     - Add a concise, evidence-grounded **"Why Ink-Bounds Preflight Matters"** breakdown on `/arabic-pdf-form-filler` and `/ar/pdf-mail-merge` (strictly synthetic specimen data, zero fake testimonials or competitor claims).

3. **Worker C (`ci-seo-launch-docs`, worktree `wt-m2-docs`)**:
   - Update `.github/workflows/ci.yml` to include `npm run test:fuzz` in CI alongside `typecheck`, `test`, `verify:pixels`, and `build`.
   - Keep `THIRD_PARTY_NOTICES.md` 100% synced with any added dependency (e.g. `fast-check`) and verify all 5 static routes + `dist/_headers` (`connect-src 'none'`, `worker-src 'self'`, `form-action 'none'`) stay strictly compliant.
   - Update bilingual `README.md` with real M2 capabilities (Web Worker 200-row batch, presets, fuzzing) and clean screenshots.
   - Add `docs/launch/demo-walkthrough.md` containing a factual 20-second demo script & honest English/Arabic community launch copy templates (zero unverified performance/revenue claims).

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`
     - `npm test` (all M1 + new M2 unit/golden tests)
     - `npm run test:fuzz` (1,000+ cases, 0 crashes)
     - `npm run verify:pixels` (PyMuPDF 4x across ALL M1 + M2 templates: 0 clipped ink pixels, 0 outside changed pixels)
     - `npm run build` (strictly 5 static routes + `dist/_headers`)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve all 12 M1 E2E scenarios
       - Add M2 E2E scenarios: **200-row batch** via Web Worker (record real timing, verify responsive UI + real ZIP containing 200 PDFs), **Cancel batch**, **1-click "Set min font to X pt"** resolving a flagged row live, **JSON mapping preset export & re-import** roundtrip, `<bdi>` mixed filename display check, zip-slip filename sanitization check, **0 outbound requests**, **0 console errors**, **0 horizontal mobile overflow** across EN & AR RTL!
     - Save updated screenshots under `docs/reports/screenshots/m2/` (`desktop-m2-flagged-delta.png`, `desktop-m2-200row-queue.png`, `desktop-m2-ar-rtl.png`, `mobile-m2-queue.png`).
     - Log real lessons in `LESSONS.md`, promote any `Seen >= 3` or repeated rules to `docs/code-standards.md`, clean up `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M2-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep changes strictly inside `D:\workspace\vibe_coding\sites\arabiform`.
