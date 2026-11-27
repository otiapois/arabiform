# Milestone 22 (M22 / v2.2.0) — ArabiForm Conditional Field Rules & Dynamic Badge/Status Formatting + 42,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.1.0` (Multi-Template Batch Packet Assembler, Arabic Numeral Policy & Official Vector Seal, Live Row Compare, Print Estimator, Offline CLI, Template Studio, 40,000+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **High-Value Enterprise Ops Workflow (`v2.2.0`)**: Event organizers, clinics, and HR teams routinely populate conditional checkboxes and status banners from one roster (e.g., `IF Role == "VIP" -> check VIP_Box = true & set Ribbon = "كبار الشخصيات / VIP"`, `IF Fee >= 500 -> set ApprovalNote = "يحتاج اعتماد مالي"`, or `IF Status != "Confirmed" -> leave BadgeCode blank`) without hacking brittle nested Excel `IF()` formulas! M22 adds a 100% browser-local, zero-eval, deterministic **Conditional Field Rules Engine** (running strictly BEFORE Arabic shaping & ink-bounds preflight so every dynamic string is ink-verified at 4×!), persisting cleanly in v11 JSON presets (100% backward-compatible with v1–v10!) and `arabiform-cli --preset`, reaching **42,500+ deterministic adversarial fuzz cases** (`v2.2.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`conditional-field-rules-42k-core`, worktree `wt-m22-core`)**:
   - **Pure Zero-DOM, Zero-Eval Conditional Field Rules Engine (`src/core/rules/conditional-fields.ts`)**:
     - Deterministic ordered rule list per mapped PDF field (ZERO `eval`/`new Function`/user RegExp — immune to injection & ReDoS!).
     - Supported operators: `equals`, `not-equals`, `contains`, `is-blank`, `is-not-blank`, `gte-number`, `lte-number` (exact decimal comparison on trimmed numeric strings — non-numeric cell values NEVER silently coerce to `0`, fail cleanly to non-match or explicit diagnostic!).
     - Supported actions when matched: `set-text` (literal bilingual Unicode string, including `{{Column}}` non-recursive token substitution), `clear-field` (empty string / unchecked), `set-checkbox` (`true | false`), `set-choice` (validated against the PDF dropdown/radio's real `/Opt` list — invalid rule target fails closed with an exact field diagnostic!).
     - Evaluation runs strictly BEFORE numeral policy, Arabic shaping, `/MaxLen`, and ink-bounds preflight so dynamically generated Arabic/bilingual strings undergo 100% identical clipping checks!
     - Persists cleanly in **v11 JSON Presets** (`v1–v10` presets remain 100% loadable with identical behavior!), exports rule match provenance in CSV/JSON diagnostics (`ruleApplied`), and runs identically in `scripts/arabiform-cli.ts` (`--preset`)!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 42,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases covering ordered rule priority, numeric boundary comparisons (leading zeros, negatives, decimals, non-numeric rejection), non-recursive token substitution, invalid choice fail-closed rejection, v1–v11 preset compatibility, and real PDF fill/extract parity!
   - **Strict Entry JS Budget**: Lazy-load Conditional Rules UI so initial entry JS stays strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes stay at `0` PDF/QR/font JS requests!

2. **Worker B (`conditional-field-rules-ui`, worktree `wt-m22-web`)**:
   - **Lazy-Loaded `Conditional rules` Collapsible Panel** inside Mapping / Output Settings (bilingual EN & AR RTL, strictly 5 static routes, zero bloat on initial render!):
     - Add/reorder/delete conditional rules targeting any mapped text, checkbox, or choice field + live matched-row counter (`Matches N of M rows`) + 1-click synthetic VIP/Standard rule example -> live PDF preview updates immediately for any matched row!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.2`, worktree `wt-m22-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.2.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 42,500 cases, 0 discarded; keep generous `>= 180_000 ms` timeouts on 500-scale fuzz tests!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying conditional Arabic banner text + toggled VIP checkbox -> `0` clipping, `0` outside-box ink!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check running `--preset` with v11 conditional rules (verifying matched Arabic text & checkbox states in emitted PDFs!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M21 scenarios + M22 Conditional Rules creation, live canvas match preview, v11 preset roundtrip (`v1–v10` untouched), EN & `/ar/` RTL, `0` outbound requests, `0` console errors, `0` mobile overflow!
     - Save screenshots under `docs/reports/screenshots/m22/` (`desktop-m22-rules-en.png`, `desktop-m22-rules-ar.png`, `mobile-m22-rules.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M22-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
