# Subsystem: Local Workbench, Live PDF Preview & Static SEO (`src/web/`)

## Workbench UX Standards
- **Zero-Friction 1-Click Demo**: Prominent **"Load Sample Arabic Roster + AcroForm PDF"** button (clearly labeled `Synthetic Sample` per `P0 Landing Claim Gate`) so any visitor instantly sees:
  - A real AcroForm template loaded on the left,
  - A synthetic bilingual Arabic roster (`ليلى حسن / 00123`, `أحمد سالم / 00007`, `بَنِي يَمَن / 00891`, plus 1 intentionally overlong name to demonstrate live fail-closed overflow detection!),
  - Instant live rendered PDF preview showing crisp unclipped Arabic diacritics & leading zeros!
- **Live In-Browser PDF Preview (`pdfjs-dist` local worker)**:
  - Render actual generated PDF pages directly to `<canvas>` inside the browser (zero external upload!) with row switcher (`Row 1 / 2 / 3...`), zoom/fit toggle, and visual red highlight boxes over any flagged fields!
- **Row-Level Preflight Queue & Inline Fix**:
  - Summary bar: `Total rows` | `Ready (Clean)` | `Flagged (Needs Review)` | `Active Font` | `Min Font Size (6–10pt slider)`.
  - Filterable row table showing exact field diagnostics; clicking any flagged row lets the user **edit the cell text inline** OR **adjust min font size** and immediately re-renders the live PDF preview until `Flagged = 0`!
- **Export Controls**:
  - `Download Clean PDFs (.zip)` (only exports passing rows by default, with clear count badge if flagged rows are excluded — never silently ships broken/clipped PDFs!)
  - `Download Merged Printable PDF (.pdf)` (1-click print-all file!)
  - `Download Preflight Audit (.csv / .json)`
- **Honest Privacy & Pricing Validation Card**:
  - Clear privacy badge: *"100% Local in Your Browser — Enforced by `CSP: connect-src 'none'`. Verify in DevTools Network tab."*
  - Subtle, honest non-fake-checkout card for recurring/large batch buyers (*"Need a custom locked template calibration or high-volume batch pass ($9 / 25-row check)? Download scope checklist"* — zero fake user counts or fake reviews!).

## Static Pre-Rendered SEO Routes (Strictly <= 5 per `SEO完整策略.md`!)
1. `/` — Main Workbench (`Fill AcroForm PDFs from CSV & Excel with Perfect Arabic & Leading Zeros`)
2. `/arabic-pdf-form-filler` — Focused English landing page (`fill pdf from csv arabic`, comparison against WinAnsi/clipping failures)
3. `/ar/pdf-mail-merge` — Clean Arabic RTL landing page (`dir="rtl"`, concise verified Arabic UI/copy, clearly marked for native reader verification before launch)
4. `/preserve-leading-zeros-pdf` — Focused page on preserving `00123` / `00007` IDs from CSV & Excel into PDFs
5. `/privacy-and-proof` — Interactive visual proof (`connect-src 'none'`, before/after unclipped Arabic rendering proof, honest supported vs unsupported PDF matrix: ordinary AcroForm YES vs XFA/scanned/signed NO).

## Cloudflare Pages Production Readiness
- Build outputs `dist/_headers` with strict `Content-Security-Policy` including `connect-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Build outputs `dist/sitemap.xml` and `dist/robots.txt` (origin via `SITE_URL`, default `https://arabiform.example`).
- Zero `<form>` elements with data-submitting `name=` attributes.
