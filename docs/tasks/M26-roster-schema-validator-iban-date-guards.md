# Milestone 26 (M26 / v2.6.0) — ArabiForm Strict MENA & Institutional Roster Schema Validator (ISO 13616 IBAN Mod-97, Real Calendar Dates, Exact Digit Lengths) + 52,500-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.5.0` (Offline `.eml` Dispatch Pack & PII Redaction, 4-Up Print-Shop Pack, Template Diff & Preset Migrator, Conditional Field Rules, Multi-Template Batch Packet Assembler, Offline CLI, 50,000+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **High-Cost Data-Entry Error Pain (`v2.6.0`)**: HR, scholarship, clinic, and finance teams routinely print 200+ official PDFs only to discover afterward that 6 rows had 1-digit typos in **GCC/EU IBANs** (`SA...`, `AE...`, `QA...`, `KW...`, `BH...`, `OM...`, `EG...`, `JO...`, `DE...`), impossible dates (`2026-02-30`!), 9-digit instead of 10-digit National IDs, or blank mandatory fields! M26 adds a 100% browser-local **Roster Schema & Institutional Field Validator** integrated directly into preflight (failing closed per invalid row BEFORE printing, with exact column & rule diagnostics!), persisting in v13 JSON presets (`v1–v12` compatible!) and `arabiform-cli`, reaching **52,500+ deterministic adversarial fuzz cases** (`v2.6.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`roster-schema-iban-validator-52k-core`, worktree `wt-m26-core`)**:
   - **Pure Zero-DOM Institutional Roster Validator (`src/core/validation/roster-schema.ts`)**:
     - Per-column opt-in validation rules evaluated deterministically BEFORE PDF export (zero `eval`, zero user RegExp):
       - `required` (fails closed on blank / whitespace-only cells),
       - `iban-mod97` (true **ISO 13616 IBAN Mod-97** BigInt checksum + exact country-code length table covering GCC/MENA & major global countries: `SA=24`, `AE=23`, `QA=29`, `KW=30`, `BH=22`, `OM=23`, `EG=29`, `JO=30`, `LB=28`, `TN=24`, `GB=22`, `DE=22`, `FR=27`, `NL=18`, `ES=24`, `IT=27` — strips display spaces strictly for validation without mutating the source value, detects ANY single-character typo or adjacent transposition 100% of the time!),
       - `iso-date` (strict `YYYY-MM-DD` real Gregorian calendar verification including exact leap-year rules — rejects `2026-02-29` & `2026-04-31`, accepts `2024-02-29`!),
       - `exact-digits` (configurable exact digit count `1..32`, e.g. `10` for Saudi Iqama/National ID or `15` for Emirates ID, preserving leading zeros!),
       - `email-format` (strict RFC-safe single-address syntax check, zero CR/LF),
       - `allowed-values` (exact case-sensitive or trimmed allowlist).
     - Integrates directly into ArabiForm's batch preflight queue: rows failing ANY enabled schema rule are flagged cleanly (`schema-validation-failed` with exact `column`, `rule`, and human-readable bilingual reason!) and excluded from production PDFs until fixed inline in the queue or skipped!
     - Persists cleanly in **v13 JSON Presets** (`v1–v12` remain 100% loadable!), exports schema failures in CSV/JSON audits, and runs identically in `scripts/arabiform-cli.ts` (`--preset`, exit `2` on strict mode!).
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 52,500+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving: (a) true ISO 13616 Mod-97 rejects 100% of single-digit mutations & adjacent transpositions across `SA/AE/QA/KW/EG/GB/DE` IBANs, (b) leap-year calendar edge cases (`1900`, `2000`, `2024`, `2026`), (c) `exact-digits` leading-zero preservation, and (d) `v1–v13` preset compatibility!
   - **Strict Entry JS Budget**: Lazy-load Schema Validation UI so initial entry JS stays strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes stay at `0` PDF/QR/font JS requests!

2. **Worker B (`roster-schema-validator-ui`, worktree `wt-m26-web`)**:
   - **Lazy-Loaded `Data validation` Collapsible Panel** inside Output Settings / Mapping (bilingual EN & AR RTL, strictly 5 static routes, wrapping extension suffixes in `<bdi dir="ltr">` in Arabic!):
     - Attach validation rules (`Required`, `IBAN (Mod-97)`, `ISO Date`, `Exact digits`, `Email`, `Allowed list`) to any roster column + **1-click Synthetic GCC Payroll / IBAN Validation Demo** -> flagged rows surface immediately in the Review Queue where fixing a 1-digit IBAN typo inline turns the row `Ready` in real time!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.6`, worktree `wt-m26-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.6.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 52,500 cases, 0 discarded; keep `>= 180_000 ms` timeouts on heavy fuzz tests!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying filled GCC IBAN + Arabic name after inline repair -> `0` clipping!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check with v13 preset (verifying bad IBAN / impossible date exits `2` with `0` PDFs in strict mode, and repaired roster exits `0`!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M25 scenarios + M26 GCC IBAN Mod-97 & impossible-date flagging, inline fix turning row ready, v13 preset roundtrip (`v1–v12` compatible), EN & `/ar/` RTL!
     - Save screenshots under `docs/reports/screenshots/m26/` (`desktop-m26-validation-en.png`, `desktop-m26-validation-ar.png`, `mobile-m26-validation.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M26-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
