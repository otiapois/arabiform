# Subsystem Design References (ArabiForm)

| Subsystem | Scope | Contract |
| --- | --- | --- |
| PDF & Font Shaping Engine (`src/core/pdf/`) | AcroForm inspection and mixed-widget preservation, text and checkbox mapping, bundled and local fonts, `fontkit` Arabic and BiDi shaping, ink bounds, ZIP and merged printable PDF, roundtrip readback | [pdf-engine.md](pdf-engine.md) |
| Browser Batch Worker (`src/core/worker/`) | Local preflight and export jobs, row progress, cancellation, and stale-result isolation | [pdf-engine.md](pdf-engine.md) |
| Roster Ingestion & Auto-Mapping (`src/core/roster/`) | CSV (`papaparse`) and XLSX ingestion, encoding and leading-zero preservation, spreadsheet source warnings, auto-mapping and safe filenames | [roster-mapper.md](roster-mapper.md) |
| Local Workbench, Live PDF Preview & Static SEO (`src/web/`) | 100% browser-local workbench, in-browser `pdfjs-dist` raster preview, row-by-row preflight queue with inline cell fix & font-size control, <= 5 static pre-rendered SEO routes, `CSP: connect-src 'none'` `_headers`, Playwright Edge E2E | [web-preview-seo.md](web-preview-seo.md) |
