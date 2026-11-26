# Lessons from Merged Work (ArabiForm)

> Modeled on `yetone/magpie/LESSONS.md`.
> Record real defects, rework patterns, or thin-verification catches after every milestone (`Rule -> Why -> Evidence -> Seen count`). Promote `Seen >= 3` separate days/cycles into [docs/code-standards.md](docs/code-standards.md).

## Active Lessons

### Seeded from M1.5 AcroForm Baseline Probe (2026-11-26)
- **Rule** — Inspect `/XFA` in the raw AcroForm dictionary before invoking `pdfDoc.getForm()`, and treat page `/Rotate` and widget `/MK /R` explicitly.
- **Why** — Calling `getForm()` first silently strips XFA layers on IRS-style hybrid forms; ignoring page rotation or widget rotation produces clipped or rotated glyphs.
- **Evidence** — Verified in `import-medic/docs/research/M1.5/02-evidence/acroform-baseline.cjs` across `irs-w9.pdf`, `irs-1040.pdf`, and `synthetic-rotated.pdf`.
- **Seen: 1** (2026-11-26)

### Seeded from M1 Static Preview & Mobile Overflow Audit (2026-11-26)
- **Rule** — Test direct slashless static route URLs on production preview and measure mobile overflow against the configured viewport (`390px`), keeping wide preview tables inside positioned scroll containers.
- **Why** — Vite preview can fall back to `/` on slashless directory routes, and screen-reader absolute text outside scroll containers silently expands mobile document width past `390px`.
- **Evidence** — Caught and fixed during ImportMedic M1 (`d9c31bc`, `e0f97fd`).
- **Seen: 1** (2026-11-26)
