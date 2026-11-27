# Milestone 20 (M20 / v2.0.0) — ArabiForm Arabic Numeral Policy Engine (Eastern ٠١٢٣ vs Western 0123), Per-Field Typography Controls & Local Official Stamp Block + 37,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v1.9.0` (Live Row Compare, Print Sheet Estimator, Offline CLI, Built-in Template Studio, 35,000+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **MENA Institutional Polish (`v2.0.0`)**: Real Gulf, Egyptian, Levant, and Maghreb official documents enforce strict **numeral script rules** — e.g. Arabic prose & dates in **Eastern Arabic-Indic numerals (`٠١٢٣٤٥٦٧٨٩`)** while National IDs, IBANs, and Badge Codes stay strictly in **Western ASCII digits (`0123456789`)**! Plus print teams want **per-field line-height / inner padding overrides** for tight government forms and a **pure-vector local Official Stamp / Approval Seal Block** (custom bilingual org text + issue date + subtle vector double-ring border — zero image uploads!) placed safely in a corner without touching widget ink. M20 ships all three in `v2.0.0` with **37,500+ adversarial fuzz cases**!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`arabic-numerals-typography-seal-37k-core`, worktree `wt-m20-core`)**:
   - **Per-Field Numeral Script Policy (`numeralPolicy: 'preserve' | 'eastern-arabic' | 'western-ascii'`, default `'preserve'`) (`src/core/shaping/numerals.ts`)**:
     - Applies deterministically per mapped text field BEFORE shaping & ink-bounds preflight (so exact rendered Eastern vs Western glyph widths are measured accurately at 4× — NEVER silent overflow after digit conversion!).
     - Preserves leading zeros identically (`00123` <-> `٠٠١٢٣`), handles mixed ASCII/Arabic-Indic/Extended-Arabic-Indic (`۰۱۲۳`) safely, leaves non-mapped fields & filenames untouched unless configured, and persists cleanly in v10 JSON presets (100% backward-compatible with v1–v9!) and CLI `--preset`!
   - **Per-Field Typography Overrides (`lineHeightScale: 1.0 | 1.15 | 1.3`, `paddingPt: 2 | 4 | 6`)**:
     - Applied identically in preflight ink-bounds measurement AND PDF appearance stream generation (`0` clipped ink pixels verified at 4×!).
   - **Pure-Vector Local Bilingual Approval Seal / Official Stamp (`src/core/pdf/approval-seal.ts`)**:
     - Draws a crisp, pure PDF vector stamp (double-line rectangular or circular institutional border + shaped Arabic/English label + issue date, configurable corner `top-left | top-right | bottom-left | bottom-right`, print-safe opacity, strictly fail-closed if the chosen corner collides with any visible AcroForm widget or QR stamp!).
     - Works identically in Browser exports AND `arabiform-cli`, verified via PyMuPDF 4× (`0` clipping, `0` widget overlap)!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 37,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases covering Eastern/Western numeral roundtrips & leading-zero preservation, line-height/padding ink-bounds exactness, Approval Seal corner collision rejection, and v1–v10 preset compatibility!
   - **Strict Entry JS Budget**: Lazy-load new M20 UI controls so initial entry JS remains strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes stay at `0` PDF/QR/font JS requests!

2. **Worker B (`numerals-typography-seal-ui`, worktree `wt-m20-web`)**:
   - Add per-field **`Digits`** (`Preserve` / `٠١٢٣` / `0123`) & compact typography controls inside Mapping rows (collapsible/inline cleanly without crowding desktop or mobile!) and an optional **`Official approval seal`** section inside Output Settings (bilingual EN & AR RTL, live preview reflected on canvas!).
   - Keep strictly 5 static routes, `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.0`, worktree `wt-m20-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.0.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 37,500 cases, 0 discarded), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying Eastern Arabic `٠٠١٢٣` + custom padding + Official Approval Seal -> `0` clipping, `0` widget overlap!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M19 scenarios + M20 per-field Eastern Arabic numerals (`00123 -> ٠٠١٢٣` in Date/Notes while keeping `00123` Western in ID!), Official Approval Seal rendering & widget-overlap block, v10 preset roundtrip (`v1–v9` compatible), `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m20/` (`desktop-m20-numerals-seal-en.png`, `desktop-m20-numerals-seal-ar.png`, `mobile-m20-seal.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M20-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims.
