# Lessons from Merged Work (ArabiForm)

> Modeled on `yetone/magpie/LESSONS.md`.
> Record real defects, rework patterns, or thin-verification catches after every milestone (`Rule -> Why -> Evidence -> Seen count`). Promote `Seen >= 3` separate days/cycles into [docs/code-standards.md](docs/code-standards.md).

## Active Lessons

### Seeded from M1.5 AcroForm Baseline Probe (2026-11-26)
- **Rule** — Inspect `/XFA` in the raw AcroForm dictionary before invoking `pdfDoc.getForm()`, and treat page `/Rotate` and widget `/MK /R` explicitly.
- **Why** — Calling `getForm()` first silently strips XFA layers on IRS-style hybrid forms; ignoring page rotation or widget rotation produces clipped or rotated glyphs.
- **Evidence** — Verified in `import-medic/docs/research/M1.5/02-evidence/acroform-baseline.cjs` across `irs-w9.pdf`, `irs-1040.pdf`, and `synthetic-rotated.pdf`.
- **Seen: 1** (2026-11-26)

### 合成 PDF 的标题与原有字段也要验字形（2026-11-26）

- **规则**　修改模板字体嵌入或子集策略后，在 PDF.js 和 PyMuPDF 中查看模板标题与保留字段，再验写入字段的值。
- **原因**　首次构建样本时，字体子集丢失了可见拉丁字母。标题和 `KEEP 00109` 字段的值仍可读取。改用完整静态字体后，1.2 倍渲染的两个取样区域分别从 1,270 增到 4,547 个深色像素，从 79 增到 201 个。
- **证据**　样本生成与字体验收见提交 `0487483` 及 [模板说明](fixtures/README.md)。本轮 QA 在 [Edge 截图](docs/reports/screenshots/desktop-preview-flagged.png) 复核了完整标题和保留字段，分别用 PDF-lib 和 PyMuPDF 核过下载文件。
- **Seen: 1**（同一缺陷，2026-11-26）

### 用 PDF trailer 判断加密状态（2026-11-26）

- **规则**　在访问页面和表单前检查 trailer 的 `/Encrypt` 及文档加密标志，保留可识别的加密错误码。
- **原因**　锁定版本的 PDF-lib 转译后，使用 `instanceof EncryptedPDFError` 检查会漏认加密错误，用户可能只能看到文件损坏提示。
- **证据**　[入口实现](src/core/pdf/template.ts)、[加密样本](fixtures/golden/encrypted.pdf) 与 [浏览器替换模板测试](tests/e2e/workbench.spec.ts) 覆盖加密拒绝及旧预览失效。
- **Seen: 1**（2026-11-26）

### Excel 文本中的字符实体只解码一次（2026-11-26）

- **规则**　以 CSV 的实际换行为参照，检查 XLSX 富文本与内联字符串的数值实体，保留原文刻意写出的实体字面量。
- **原因**　曾将工作簿里代表换行的 `&#10;` 原样填入 PDF。简单重复解码又会把 `&amp;#10;` 错转为换行。
- **证据**　[富文本回归用例](tests/core/roster.test.ts) 区分两种情况。[双格式下载验收](tests/e2e/downloads.ts) 将每份单页 PDF 的多行 Notes 与 CSV 源文逐字符比较。
- **Seen: 1**（2026-11-26）

### 像素对照使用该次填充时的源字节（2026-11-26）

- **规则**　记录填充时读入的模板，以源文件哈希命名像素对照快照。
- **原因**　并行重新生成 golden 模板时，像素校验可能重新打开已变动的模板，把底图差异误认为填充越界。
- **证据**　[像素校验入口](scripts/verify-pdf-pixels.ts) 在保存输出时冻结同批源字节。[4 倍渲染校验](scripts/verify-pdf-pixels.py) 从清单读取对应快照。
- **Seen: 1**（2026-11-26）

### Seeded from M1 Static Preview & Mobile Overflow Audit (2026-11-26)
- **Rule** — Test direct slashless static route URLs on production preview and measure mobile overflow against the configured viewport (`390px`), keeping wide preview tables inside positioned scroll containers.
- **Why** — Vite preview can fall back to `/` on slashless directory routes, and screen-reader absolute text outside scroll containers silently expands mobile document width past `390px`.
- **Evidence** — Caught and fixed during ImportMedic M1 (`d9c31bc`, `e0f97fd`).
- **Seen: 1** (2026-11-26)
