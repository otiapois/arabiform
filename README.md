# ArabiForm

ArabiForm fills interactive PDF text fields from a CSV or Excel (`.xlsx`) roster in your browser. Map columns to fields, preview Arabic and mixed-script rows, and correct flagged entries before export. The workbench preserves IDs stored as text, such as `00123`, and warns about numeric Excel cells that may have lost digits or zeros. Export passing rows as individual PDFs in a ZIP or one printable PDF, and download diagnostics as CSV or JSON.

Use ordinary AcroForm PDFs with editable text fields. XFA forms, signed or encrypted PDFs, and scanned or flat PDFs without interactive fields are outside the supported scope. **Try Synthetic Arabic Sample** uses a fictional roster with one intentionally overlong entry. Files are processed on your device. The production Content Security Policy uses `connect-src 'none'` to block browser connections such as `fetch`.

## Run and verify locally

CI uses Node.js 24, Python 3.13, and `PyMuPDF==1.26.7`. From the repository root, install dependencies and run the CI checks.

```sh
npm ci --ignore-scripts
python -m pip install PyMuPDF==1.26.7
npm run typecheck
npm test
npm run verify:pixels
npm run build
```

The committed synthetic PDFs, CSV, and workbook support offline testing after install. Run `npm run generate:fixtures -- --check` to compare the generated fixture bytes against the tracked copies. See the [fixture guide](fixtures/README.md) for cases and optional public blank-template checks.

For a local run, use `npm run dev`. Use `npm run preview` after a build to serve the production headers at `http://127.0.0.1:4173`. Run `npm run test:e2e` with Microsoft Edge installed. The Edge suite is separate from the CI checks above and uses the installed browser.

For Windows development, keep the checkout, worktrees, dependencies, and Python environment on `D:`. Direct npm and pip caches to `D:\cache\arabiform\npm` and `D:\cache\arabiform\pip` with their `--cache` and `--cache-dir` flags. Point the local session’s `TEMP` and `TMP` to an existing `D:` directory. If you need a Playwright browser cache, set `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright`.

## Static build

`npm run build` produces five static routes, local assets, a sitemap, `robots.txt`, Cloudflare Pages `_headers`, and license notices in `dist/`. Set `SITE_URL` to the actual site's origin before a release build. `https://arabiform.example` is the local placeholder. Serve the files from the origin root with the response headers in `_headers`.

See the [project instructions](AGENTS.md), [subsystems](docs/subsystems/README.md), [code standards](docs/code-standards.md), [lessons](LESSONS.md), and [milestone brief](docs/tasks/M1-arabiform-kickoff.md). [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## العربية

تملأ أداة ArabiForm الحقول النصية التفاعلية في ملفات PDF من جدول CSV أو Excel داخل المتصفح. اربط الأعمدة بالحقول وعاين الصفوف وعدّل أي نص يتجاوز حدود الحقل قبل التصدير. تُحفَظ الأصفار في بداية المعرّفات المخزّنة كنص، مثل `00123`. يمكنك تنزيل الصفوف الجاهزة كملفات PDF منفصلة في أرشيف ZIP أو كملف PDF واحد للطباعة، وتنزيل تقرير المراجعة بصيغة CSV أو JSON.

تدعم الأداة نماذج AcroForm ذات الحقول النصية القابلة للتحرير. نماذج XFA والملفات الموقّعة أو المشفّرة والملفات الممسوحة ضوئيًا بلا حقول تفاعلية خارج نطاق الدعم. تتضمن العينة الاصطناعية بيانات خيالية وصفًا طويلًا عمدًا لتجربة المراجعة.

بعد تثبيت الحزم، يمكن تنفيذ الاختبارات بالملفات الاصطناعية المرفقة دون اتصال بالإنترنت. استخدم أوامر التحقق أعلاه مع Node.js 24 وPython 3.13. لمعاينة النسخة المبنية مع ترويسات الأمان، شغّل `npm run preview` بعد البناء. يتطلب `npm run test:e2e` تثبيت Microsoft Edge. على Windows، احتفظ بملفات العمل والملفات المؤقتة وذاكرات التخزين المؤقت على القرص `D:`. تُحفَظ ملفات الموقع الثابتة في `dist/`، وتُضبَط قيمة `SITE_URL` على عنوان الموقع الفعلي عند تجهيز نسخة للنشر.
