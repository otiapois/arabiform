# Subsystem Design References (ArabiForm)

| Subsystem | Scope | Contract |
| --- | --- | --- |
| PDF & Font Shaping Engine (`src/core/pdf/`) | AcroForm inspection, XFA/encryption/signature/flat-PDF guards, `fontkit` Arabic + BiDi shaping, true ink-BBox auto-baseline, multiline wrapping, multi-widget atomicity, ZIP & Merged Printable PDF export, roundtrip readback | [pdf-engine.md](pdf-engine.md) |
| Roster Ingestion & Auto-Mapping (`src/core/roster/`) | CSV (`papaparse`) + Excel `.xlsx` strict text-mode parsing, UTF-8/BOM/Windows-1252 decoding, leading-zero preservation (`00123`), scientific-notation corruption warning, smart field auto-mapping, safe filename templating | [roster-mapper.md](roster-mapper.md) |
| Local Workbench, Live PDF Preview & Static SEO (`src/web/`) | 100% browser-local workbench, in-browser `pdfjs-dist` raster preview, row-by-row preflight queue with inline cell fix & font-size control, <= 5 static pre-rendered SEO routes, `CSP: connect-src 'none'` `_headers`, Playwright Edge E2E | [web-preview-seo.md](web-preview-seo.md) |
