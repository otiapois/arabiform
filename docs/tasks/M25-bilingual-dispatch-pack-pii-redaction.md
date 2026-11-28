# Milestone 25 (M25 / v2.5.0) — ArabiForm Bilingual Offline Email Dispatch Pack (`.eml` + Attachment) & Per-Field PII Redacted Review Copies + 50,000-Case Adversarial Fuzz

> **Repo Root**: `D:\workspace\vibe_coding\sites\arabiform`
> **Worktree Base**: `D:\workspace\vibe_coding\sites\.arabiform-wt\`
> **Baseline**: Verified `v2.4.0` (A4 4-Up Print-Shop Pack & Preflight Certificate, Template Diff & Preset Migrator, Conditional Field Rules, Multi-Template Batch Packet Assembler, Arabic Numeral Policy & Official Vector Seal, Offline CLI, 47,500+ fuzz, PyMuPDF 4× 0-clipping, entry JS `< 274 kB / 85.8 kB gzip`).
> **Real-World HR, Clinic & University Distribution Pain (`v2.5.0`)**: After generating 100+ Arabic/English certificates, offer letters, or clinic summaries, ops teams face two painful manual tasks: (1) attaching the right person's PDF to the right recipient email without accidentally sending Alice's offer letter to Bob (and WITHOUT giving a web app SMTP/Gmail API permissions!), and (2) sharing a **PII-Redacted Review Copy** (`ID: ****0123`) with external QA/auditors without exposing full National IDs or phone numbers! M25 adds a 100% browser-local **Offline RFC 5322 `.eml` Dispatch Draft Pack** (double-click directly in Outlook/Apple Mail/Thunderbird with the exact PDF already attached!) AND deterministic **Per-Field PII Redacted Review Mode**, plus CLI support and **50,000+ deterministic adversarial fuzz cases** (`v2.5.0`)!

## Required 4-Worker Agent Team Topology

Act as **Lead Orchestrator** (`gpt-6.2-sol`) using isolated git worktrees under `D:\workspace\vibe_coding\sites\.arabiform-wt\`:

1. **Worker A (`eml-dispatch-pii-redaction-50k-core`, worktree `wt-m25-core`)**:
   - **Pure Zero-DOM RFC 5322 / MIME `.eml` Dispatch Pack Generator (`src/core/dispatch/eml-pack.ts`)**:
     - Builds standards-compliant offline `.eml` draft files (`MIME-Version: 1.0`, `X-Unsent: 1`, `Content-Type: multipart/mixed`, UTF-8 Base64 `text/plain` bilingual body + Base64 `application/pdf` attachment matching the exact emitted per-row PDF bytes!).
     - Encodes non-ASCII Arabic/Unicode `Subject` headers with valid RFC 2047 UTF-8 Base64 (`=?UTF-8?B?...?=`) and supports safe non-recursive `{{Column}}` tokens in subject & body!
     - **Fail-Closed Email & Header Injection Guard**: strictly validates every ready row's recipient email column (rejecting missing/malformed emails and strictly blocking ANY `\r` or `\n` CR/LF header-injection characters in `To`, `Cc`, `Subject`, or attachment filename with exact row diagnostics — NEVER emitting a single `.eml` if any targeted row fails validation!).
     - Packages all `.eml` drafts into a ZIP + **Dispatch Ledger CSV & JSON** recording exact `Row -> Recipient Email -> Attached PDF Filename -> PDF SHA-256 -> EML SHA-256`!
   - **Per-Field PII Redacted Review Mode (`maskPolicy: 'none' | 'keep-last-4' | 'full-mask'`) (`src/core/shaping/redaction.ts`)**:
     - Deterministically masks sensitive mapped text fields (`0012345678` -> `******5678` under `keep-last-4`, or `••••••••` / `****` under `full-mask`, preserving Eastern/Western numeral visibility safely when needed and running strictly BEFORE shaping & ink-bounds preflight so redacted output NEVER clips!).
     - Stamps redacted exports clearly in the Custody Manifest (`redactedReview: true`, `redactedFields: [...]`) so an auditor never mistakes a redacted review PDF for a production original!
   - Wire `--dispatch-eml` and `--redact-field` cleanly into `scripts/arabiform-cli.ts`!
   - **Expand Seeded Fuzz Coverage (`npm run test:fuzz`) to 50,000+ Total Cases (`0` discarded, `0` crashes)**:
     - Add 2,500+ deterministic fuzz cases proving: (a) `.eml` Base64 attachment decodes byte-for-byte identically to the source PDF bytes, (b) ZERO raw `\r`/`\n` header injection can ever pass into `.eml` headers, (c) RFC 2047 Arabic subject roundtrip decodes cleanly, and (d) `keep-last-4` / `full-mask` redaction NEVER leaks unmasked prefix characters across arbitrary Unicode/Arabic strings!
   - **Strict Entry JS Budget**: Lazy-load Dispatch & Redaction UI so initial entry JS stays strictly BELOW **`274 kB raw / 85.8 kB gzip`** (`verify:release` PASS) and idle EN & AR routes stay at `0` PDF/QR/font JS requests!

2. **Worker B (`eml-dispatch-redaction-ui`, worktree `wt-m25-web`)**:
   - **Lazy-Loaded `Email drafts (.eml)` & `Redacted review` Controls** inside Output Settings (bilingual EN & AR RTL, strictly 5 static routes, wrapping `(.eml)` / `(.zip)` / `(.csv)` suffixes in `<bdi dir="ltr">` inside Arabic buttons!):
     - Pick `Recipient email column`, enter bilingual `Subject` & `Message` template with `{{Column}}` preview -> 1-click download **Offline Email Drafts (.zip)** + **Dispatch Ledger (.csv)**!
     - Per-field optional `Mask for review` (`None / Keep last 4 / Full mask`) with instant live preview on canvas!
   - Keep `0` outbound requests, `0` console errors, `0` idle PDF/QR/font JS requests, `0` horizontal mobile overflow at `390px`, and WCAG AA contrast!

3. **Worker C (`release-docs-v2.5`, worktree `wt-m25-docs`)**:
   - Bump `package.json` & `package-lock.json` cleanly to `2.5.0`, update bilingual `CHANGELOG.md`, `README.md`, and `docs/subsystems/` (zero fake claims!).
   - Verify `npm run verify:release` (default + strict-origin), `npm run generate:fixtures -- --check`, strictly 5 static routes, `THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `dist/_headers`.

4. **Worker D (`qa-adversarial`, independent `DOER != CHECKER`)**:
   - After Lead merges A–C into `main`, run full independent verification:
     - `npm run typecheck`, `npm test`, `npm run test:fuzz` (>= 50,000 cases, 0 discarded; keep `>= 180_000 ms` timeouts on heavy fuzz tests!), `npm run generate:fixtures -- --check`, `npm run verify:pixels` (PyMuPDF 4× verifying redacted Arabic+ID fields -> `0` clipping, `0` unmasked prefix!), `npm run build`, `npm run verify:release` (default + strict-origin, entry JS `< 274 kB / 85.8 kB gzip`!)
     - Real CLI subprocess check for `--dispatch-eml` (verifying Base64 PDF attachment byte-parity & exit `2` on malformed/CRLF-injected email!)
     - `npm run test:e2e` (real Microsoft Edge desktop `1440x900` + mobile `390x844`): preserve 100% of M1–M24 scenarios + M25 `.eml` ZIP download & MIME attachment decode verification, malformed email fail-closed block, and `keep-last-4` live canvas redaction in EN & `/ar/` RTL!
     - Save screenshots under `docs/reports/screenshots/m25/` (`desktop-m25-dispatch-en.png`, `desktop-m25-redacted-ar.png`, `mobile-m25-dispatch.png`).
     - Update `LESSONS.md`, promote any `Seen >= 3` rules into `docs/code-standards.md`, remove `D:\workspace\vibe_coding\sites\.arabiform-wt\`, and commit `docs/reports/M25-verification.md` on clean `main`.

Hard constraints: keep all caches/tmp/worktrees strictly on `D:` (protect `C:` free space); ZERO external runtime requests; ZERO fake claims; keep `fixtures/.gitattributes` wildcard rules intact.
