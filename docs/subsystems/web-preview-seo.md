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
  - Search row numbers, filenames and cell values. The `All`, `Ready`, `Flagged` and `Source warnings` filters paginate at 20 rows per page. In the queue and selected-row summary, filenames use `<bdi dir="ltr">` with isolated Unicode stem runs. The stem can wrap while the `.pdf` extension stays at its right edge. The title, selection text, audit and ZIP use the logical filename.
  - Source warnings show spreadsheet cell coordinates. Mapped Excel formula cells warn whether a stored result is present, so the operator can verify stale results or enter a verified value for an empty cell.
  - Show a proven font-size threshold or MaxLen excess beside the red preview highlights and in the selected row editor. Offer `Set min font to X pt` when each failure in the selected row can be resolved within the 6 pt floor. Changing that setting checks the full batch again.
- **Local Worker Lifecycle**:
  - A dedicated, first-party Web Worker runs preflight, ZIP creation and merged PDF creation. It retains the PDF bytes between operations and sends row metadata, the requested single-row preview, and the completed file back to the interface.
  - Show the current phase and completed/total count. `Cancel batch` terminates the worker and clears the results and pending downloads. `Resume batch` rechecks the retained files and edits in a fresh worker. Replacing inputs or editing preflight settings also invalidates the previous worker.
- **Local Mapping Presets**:
  - The mapping panel tags text, checkbox, radio and dropdown fields. Editable text and checkbox fields can be mapped. Other listed fields stay untouched. An empty mapping leaves the PDF field unchanged.
  - The version 1 JSON file stores the field-to-column `mapping` (including checkboxes), `filenamePattern`, `minFontSize` (6–10 pt), and bundled `font` (`auto`, `arabic` or `latin`). Import validates the entire file, skips unavailable fields and columns, and reports mismatches. Presets can be imported before source files are chosen.
  - Custom TTF/OTF bytes stay in this tab's memory. Output Settings displays the parsed family name and preflight glyph coverage feedback. Selecting a replacement invalidates existing results immediately. Loading or rejecting a font disables exports until a valid font is selected or the custom font is cleared. Clearing it uses the selected bundled font. A valid preset import uses its bundled font setting and clears a prior custom selection.
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

The English Arabic PDF guide and the Arabic mail merge guide explain ink-bounds preflight using the same fictional name from the sample roster. Their page summaries and guide copy are authored in `scripts/prerender.mjs` and carried into the interactive workbench from the static page.

## Cloudflare Pages Production Readiness
- Build outputs `dist/_headers` with strict `Content-Security-Policy` including `connect-src 'none'` and `worker-src 'self'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- Build outputs `dist/sitemap.xml` and `dist/robots.txt` (origin via `SITE_URL`, default `https://arabiform.example`).
- Zero `<form>` elements with data-submitting `name=` attributes.
