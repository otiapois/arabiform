# Milestone 5 (M5-RC) — ArabiForm Release Candidate: Filename Collision Preview, Keyboard A11y, Lean Code-Splitting & 5,000+ Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Accepted M4 (`b99cd71`, 45/45 Vitest, 4,100 fuzz cases, PyMuPDF 4x 76/87 widgets 0-clipping, 38/38 real Edge E2E).
> **Budget & Scope**: Tight, high-leverage Release Candidate polish pass (3-Worker lean team + independent QA) targeting `v0.5.0` readiness cleanly inside the remaining ~7–8% weekly quota.

## Required 3-Worker Agent Team Topology (Lean RC Polish)

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`rc-collision-fuzz-bundle`, worktree `wt-m5-core`)**:
   - **Filename Collision & Sanitization Metadata**:
     - Expose structured `filenameAdjusted: boolean` + `filenameAdjustReason` (`sanitized` | `reserved-name` | `collision-dedup`) on every row preflight result so the UI can surface a clear, honest badge whenever a ZIP member name was auto-sanitized or deduplicated (`-2`, `-3`) — keeping existing CSV/JSON audit schema 100% backward-compatible!
   - **5,000+ Deterministic Stress Fuzz (`npm run test:fuzz`)**:
     - Expand seeded `fast-check` fuzzing from `4,100` to **5,000+ total cases** (adding collision/reserved-name stress + mixed RTL/LTR choice & custom-font edge stress) with `0` discarded cases and `0` uncaught crashes.
   - **Lean Vite Bundle & Chunk Polish**:
     - Tune `vite.config.ts` manualChunks / lazy dynamic loading cleanly so the initial page entry JS stays compact (`< 300 kB` raw / `< 95 kB` gzip) and heavy PDF/font/preview chunks load strictly on demand from local static assets (`connect-src 'none'`, `worker-src 'self'`, `0` CDN!).

2. **Worker B (`rc-a11y-collision-ui`, worktree `wt-m5-web`)**:
   - **Pre-Export Filename Adjustment Indicator**:
     - Display a subtle, accessible bilingual badge (`Filename adjusted` / `تم تعديل اسم الملف`) beside any row in the Preflight Queue whose output PDF filename was sanitized or deduplicated before export, with tooltip/detail explaining why (`collision-dedup`, `reserved-name`, `sanitized`).
   - **Keyboard & WCAG AA Accessibility Polish (EN + AR RTL)**:
     - Pressing `/` (when focus is outside inputs/textareas/selects) focuses the Preflight Queue search input; pressing `Escape` cancels an active inline row edit and returns focus cleanly to that row's `Edit row N` button.
     - Audit visible focus outlines (`>= 2px`), `aria-live="polite"` batch status announcements, and checkbox/label spacing across both `/` and `/ar/pdf-mail-merge` (0 horizontal overflow on 390px mobile!).
   - **Bilingual Release Candidate Docs**:
     - Update `README.md` with crisp M4+M5 feature summary (dropdown/radio mapping, flattened print ZIP, multi-page flag jump, filename collision indicator, keyboard shortcuts) and verify `.github/workflows/ci.yml`, `THIRD_PARTY_NOTICES.md`, strictly 5 static routes, and `dist/_headers` (`connect-src 'none'`, `worker-src 'self'`, `form-action 'none'`).

3. **Worker C (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–B into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (5,000+ cases), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4x across ALL M1–M5 templates: 0 clipped ink pixels, 0 outside pixel changes), `npm run build` (5 static routes + `_headers`)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`):
       - Preserve all 38 M1–M4 Edge E2E scenarios
       - Add M5-RC Edge E2E scenarios:
         1. Filename collision & reserved-name roster -> verify `Filename adjusted` badges visible in queue on BOTH EN & AR RTL before download, AND downloaded ZIP members match displayed names!
         2. Keyboard `/` focuses search input; `Escape` closes inline row editor and restores focus cleanly to `Edit row N` with visible focus ring!
         3. Assert **0 outbound requests**, **0 console errors**, **0 horizontal mobile overflow**!
     - Save screenshots under `docs/reports/screenshots/m5/` (`desktop-m5-collision-badges.png`, `desktop-m5-ar-rtl-rc.png`, `mobile-m5-rc.png`).
     - Update `LESSONS.md` (promote any `Seen >= 3` rules into `docs/code-standards.md`), clean up `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M5-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
