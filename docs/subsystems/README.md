# Subsystem Design References (ArabiForm)

| Subsystem | Scope | Contract |
| --- | --- | --- |
| PDF & Font Shaping Engine (`src/core/pdf/`) | AcroForm inspection, text and checkbox mapping, dropdown and radio choices, bundled and local font shaping and ink bounds, per-text-field alignment, mixed-widget preservation, editable and flattened PDF exports, optional print manifest, roundtrip readback | [pdf-engine.md](pdf-engine.md) |
| Browser Batch Worker (`src/core/worker/`) | Local preflight and export jobs, retained batch results for the cover, row progress, cancellation, and stale-result isolation | [pdf-engine.md](pdf-engine.md) |
| Roster Ingestion & Auto-Mapping (`src/core/roster/`) | CSV (`papaparse`) and XLSX ingestion, encoding and leading-zero preservation, spreadsheet source warnings, opt-in column hygiene with Undo, auto-mapping and safe filenames | [roster-mapper.md](roster-mapper.md) |
| Portable Batch Drafts (`src/core/draft/`) | Local JSON serialization and validation, source and font matching, edits, cleanup summaries, field mapping, and output settings | [web-preview-seo.md](web-preview-seo.md#local-batch-drafts) |
| Local Workbench, Live PDF Preview & Static SEO (`src/web/`) | Browser-local workbench, `pdfjs-dist` raster preview with zoom and flagged-page navigation, row fixes and batch font-size suggestions, versioned JSON mapping presets, synthetic workflows and ink-bounds specimen, five static routes, production CSP, Playwright Edge E2E | [web-preview-seo.md](web-preview-seo.md) |
