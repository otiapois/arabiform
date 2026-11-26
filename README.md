# ArabiForm

ArabiForm fills interactive PDF text fields from a CSV or Excel (`.xlsx`) roster in your browser. Map columns to fields, preview Arabic and mixed-script rows, and correct flagged entries before export. The workbench preserves IDs stored as text, such as `00123`, and warns about numeric Excel cells that may have lost digits or zeros.

1. Choose an ordinary AcroForm PDF with editable text fields and a roster. Use **Try Synthetic Arabic Sample** to try a fictional roster with one deliberately overlong entry you can fix by editing the text.
2. Review the preflight queue. Search a 200-row roster by row number, filename, or cell value. Filter by ready rows, flagged rows, or source warnings, and page through the results.
3. Select a flagged row to see the outlined field and its diagnostic. The queue can show the largest size that fits or how many characters exceed the field’s `MaxLen`. When lowering the minimum to at least 6 pt would resolve the flag, the workbench offers to apply that size and run preflight again. If the field still needs review, edit the cell or the template and check the preview.
4. Export passing rows as individual PDFs in a ZIP or as one printable PDF. Download the row diagnostics separately as CSV or JSON.

The local Web Worker runs preflight and the two PDF exports off the main browser thread. The workbench shows the phase and completed row count while a batch runs. **Cancel batch** stops the active job and discards any late results.

Export a JSON mapping preset to reuse your field mappings, filename pattern, minimum font size, and font mode. A preset contains settings only. Review any missing fields reported when you import it against a different template.

The workbench rejects XFA, signed or encrypted PDFs, and flat or scanned PDFs without interactive text fields. Templates, rosters, previews, and exports stay on your device. The built site restricts browser connections with `connect-src 'none'`, loads workers from its own origin, and blocks form submission.

See the [synthetic demo walkthrough](docs/launch/demo-walkthrough.md), [desktop field warning](docs/reports/screenshots/desktop-preview-flagged.png), and [mobile preview](docs/reports/screenshots/mobile-preview.png). Both screenshots are from the M1 synthetic sample.

## Run and verify locally

CI uses Node.js 24, Python 3.13, and `PyMuPDF==1.26.7`. From the repository root, install dependencies and run the CI checks.

```sh
npm ci --ignore-scripts
python -m pip install PyMuPDF==1.26.7
npm run typecheck
npm test
npm run test:fuzz
npm run verify:pixels
npm run build
```

The committed synthetic PDFs, CSV, and workbook support offline testing after install. Run `npm run generate:fixtures -- --check` to compare the generated fixture bytes against the tracked copies. See the [fixture guide](fixtures/README.md) for cases and optional public blank-template checks.

For a local run, use `npm run dev`. Use `npm run preview` after a build to serve the production headers at `http://127.0.0.1:4173`. Run `npm run test:e2e` with Microsoft Edge installed. The Edge suite is separate from the CI checks above and uses the installed browser.

The seeded fuzz tests exercise roster parsing, filename handling, mixed-direction text layout, and AcroForm filling. The 4× PyMuPDF checks compare the rendered fixtures with their source templates. These checks cover the exercised templates and inputs. Inspect the preview for your own template before printing a batch. See the [M1 verification report](docs/reports/M1-verification.md) for the Edge versions, viewport sizes, and pixel observations from the baseline.

For Windows development, keep the checkout, worktrees, dependencies, and Python environment on `D:`. Direct npm and pip caches to `D:\cache\arabiform\npm` and `D:\cache\arabiform\pip` with their `--cache` and `--cache-dir` flags. Point the local session’s `TEMP` and `TMP` to an existing `D:` directory. If you need a Playwright browser cache, set `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright`.

## Static build

`npm run build` writes five static routes to `dist/` along with local assets, a sitemap, `robots.txt`, Cloudflare Pages `_headers`, and license notices.

- `/`
- `/arabic-pdf-form-filler`
- `/ar/pdf-mail-merge`
- `/preserve-leading-zeros-pdf`
- `/privacy-and-proof`

Set `SITE_URL` to the actual site's origin before a release build. `https://arabiform.example` is the local placeholder. Serve the files from the origin root with the response headers in `_headers`. The privacy and worker directives are `connect-src 'none'; worker-src 'self'; form-action 'none'`.

See the [project instructions](AGENTS.md), [subsystems](docs/subsystems/README.md), [code standards](docs/code-standards.md), [lessons](LESSONS.md), and [M2 brief](docs/tasks/M2-arabiform-hardening.md). [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## العربية

تملأ أداة ArabiForm الحقول النصية التفاعلية في ملفات PDF من جدول CSV أو Excel داخل المتصفح. اربط أعمدة الجدول بالحقول وعاين الأسماء العربية والنص المختلط. تُحفَظ الأصفار في بداية المعرّفات المخزّنة كنص، مثل `00123`، ويظهر تنبيه إذا كان Excel قد حوّل المعرّف إلى رقم قد تكون أصفاره أو بعض خاناته ضاعت.

1. اختر نموذج AcroForm فيه حقول نصية قابلة للتعبئة، ثم اختر جدول البيانات. في العينة الاصطناعية أسماء وأرقام خيالية، وفي الصف الأخير اسم طويل عمدًا لتجربة تعديله.
2. راجع قائمة نتائج الفحص المسبق. يمكنك البحث في قائمة من 200 صف برقم الصف أو اسم الملف أو محتوى خلية، ثم تصفية النتائج بحسب الجاهزية أو الحاجة إلى المراجعة أو تنبيهات بيانات المصدر والتنقّل بين صفحاتها.
3. اختر صفًا يحتاج إلى المراجعة لترى الحقل المحدد وسبب التنبيه. قد يعرض التنبيه أكبر حجم خط يتّسع له الحقل أو عدد الأحرف الزائدة عن الحد المسموح به. إذا أمكن حلّ المشكلة بخفض الحد الأدنى لحجم الخط إلى 6 نقاط أو أكثر، تعرض الأداة زرًا لتطبيق الحجم المقترح وإعادة الفحص. يمكنك أيضًا تعديل النص أو القالب ومراجعة المعاينة.
4. نزّل الصفوف الجاهزة كملفات PDF منفصلة في أرشيف ZIP أو كملف PDF واحد للطباعة. يمكنك تنزيل تقرير الفحص بصيغة CSV أو JSON.

يعمل الفحص المسبق وتصدير PDF في مهمة مستقلة عن واجهة المتصفح (Web Worker). تعرض الأداة مرحلة العمل وعدد الصفوف المعالَجة. عند الإلغاء تتوقّف الدفعة الجارية، ولا تحل نتائجها محلّ نتائج دفعة لاحقة.

احفظ ربط الأعمدة بالحقول ونمط تسمية الملفات والحد الأدنى لحجم الخط ونوعه في إعداد مسبق بصيغة JSON. يحتوي هذا الملف على الإعدادات فقط. إذا غاب أحد الحقول عند استيراده مع قالب آخر، تعرض الأداة تنبيهًا لمراجعته.

ترفض الأداة نماذج XFA والملفات الموقّعة أو المشفّرة وملفات PDF التي تخلو من الحقول النصية التفاعلية. تبقى ملفاتك على جهازك أثناء المعالجة والمعاينة والتصدير. تقيّد النسخة المبنية اتصالات المتصفح عبر `connect-src 'none'`، وتحمّل مهام المعالجة من الموقع نفسه، وتمنع إرسال النماذج.

راجع [سيناريو العرض بالعربية والإنجليزية](docs/launch/demo-walkthrough.md) و[لقطة الواجهة العربية من العينة الاصطناعية في M1](docs/reports/screenshots/desktop-ar-rtl.png).

بعد تثبيت الحزم، يمكن تنفيذ الاختبارات بالملفات الاصطناعية المرفقة دون اتصال بالإنترنت. يختبر الأمر `npm run test:fuzz` حالات مولّدة يمكن إعادة اختبارها، منها قراءة الجداول وأسماء الملفات واتجاه النص وتعبئة الحقول. يقارن PyMuPDF صور النماذج قبل التعبئة وبعدها بتكبير 4 أضعاف. تغطّي النتائج النماذج والبيانات المشمولة بالاختبارات. عاين قالبك قبل طباعة الدفعة.

استخدم أوامر التحقق أعلاه مع Node.js 24 وPython 3.13. لمعاينة النسخة المبنية مع ترويسات الأمان، شغّل `npm run preview` بعد البناء. يتطلب `npm run test:e2e` تثبيت Microsoft Edge. على Windows، احتفظ بملفات العمل والملفات المؤقتة وذاكرات التخزين المؤقت على القرص `D:`. تُحفَظ صفحات الموقع الثابتة الخمس في `dist/`، وتُضبَط قيمة `SITE_URL` على عنوان الموقع الفعلي عند تجهيز نسخة للنشر.
