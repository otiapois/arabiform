import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const routes = [
  {
    path: '/',
    title: 'Fill PDF Forms from CSV & Excel | ArabiForm',
    description: 'Fill interactive PDF templates from CSV or Excel in your browser. Preview Arabic and Unicode text, review flagged rows, and export ready PDFs.',
    heading: 'Fill PDF forms from CSV or Excel',
    summary: 'Use one interactive PDF template for a whole roster. Map your columns, review Arabic and mixed-script text in the PDF preview, and export the rows that pass.',
    guide: 'The PDF mail merge workflow',
    paragraphs: [
      'Choose an editable AcroForm PDF and a CSV or .xlsx roster. Map text, checkboxes, dropdowns, and radio buttons, then review flagged entries. Select a listed value for an invalid choice or adjust the minimum font size for text that needs more room.',
      'The ZIP contains one PDF per passing row. Keep the fields editable or flatten each PDF for print sharing. The merged printable PDF collects the passing rows in one file. You can also download the row diagnostics as CSV or JSON.',
    ],
    faq: [
      ['Can I try the tool without my own files?', 'Use the Synthetic Arabic Sample to load a fictional roster and a demo PDF. One row is deliberately too long so you can try editing it.'],
      ['What type of PDF template can I use?', 'Use an ordinary AcroForm PDF with editable text fields, checkboxes, dropdowns, or radio buttons. Leave a field unmapped to preserve its original value in editable PDFs. XFA forms, flat PDFs, signed PDFs, and encrypted PDFs are outside the supported scope.'],
    ],
    links: [
      ['/arabic-pdf-form-filler', 'Fill an Arabic PDF form'],
      ['/ar/pdf-mail-merge', 'دمج بيانات الجداول في ملفات PDF', 'ar'],
      ['/preserve-leading-zeros-pdf', 'Preserve leading zeros in PDF fields'],
      ['/privacy-and-proof', 'Check privacy and supported templates'],
    ],
  },
  {
    path: '/arabic-pdf-form-filler',
    title: 'Arabic PDF Form Filler from CSV or Excel | ArabiForm',
    description: 'Fill AcroForm text fields with Arabic names, diacritics, and mixed-script IDs. Review the rendered PDF and fix flagged rows before exporting.',
    heading: 'Fill Arabic PDF forms with a roster',
    summary: 'Fill interactive PDF fields with Arabic and mixed-script text. The workbench measures the drawn letters and diacritics to catch clipping before export.',
    guide: 'Why ink-bounds preflight matters',
    inkSpecimen: true,
    paragraphs: [
      'The marks above the letters and strokes below the baseline take up space. ArabiForm shapes the text in bundled Noto fonts and checks the edges of the drawn letters and marks against the space inside each field.',
      'Select the deliberately long name in the synthetic roster to see a field outlined in red. If the text fits at a smaller size within the supported range, the workbench shows the required size. Edit the value or adjust the minimum and check again. PDF exports include rows that pass.',
    ],
    faq: [
      ['Can I fill a name with tashkeel?', 'You can enter a name with diacritics, such as بَنِي يَمَن. Check the rendered PDF preview to see how it fits the field.'],
      ['What happens when a long name will not fit?', 'The workbench flags the row for review. Only rows that pass preflight go into the ZIP and the merged printable PDF.'],
    ],
    links: [
      ['/', 'Open the PDF mail merge workbench'],
      ['/ar/pdf-mail-merge', 'اقرأ الدليل بالعربية', 'ar'],
    ],
  },
  {
    path: '/ar/pdf-mail-merge',
    lang: 'ar',
    title: 'دمج بيانات CSV وExcel في نماذج PDF | ArabiForm',
    description: 'املأ حقول نماذج PDF التفاعلية من جدول CSV أو Excel. عاين الأسماء العربية والأرقام قبل تصدير الملفات، وكل ذلك داخل متصفحك.',
    heading: 'املأ نماذج PDF من جدول بيانات',
    summary: 'اربط أعمدة جدول CSV أو Excel بالحقول النصية وخانات الاختيار والقوائم المنسدلة وأزرار الاختيار في نموذج PDF. يفحص المتصفح مساحة الحروف والتشكيل داخل الحقل قبل التنزيل.',
    guide: 'لماذا نفحص حدود الحروف قبل التصدير؟',
    inkSpecimen: true,
    paragraphs: [
      'يشغل التشكيل فوق الحروف وأجزاء الحروف تحت السطر مساحةً داخل الحقل. يرسم ArabiForm النص بخطوط نوتو المضمّنة ويقارن حدود الحروف وعلامات التشكيل بمساحة الحقل المتاحة.',
      'اختر الصف الذي يتعمّد عرض اسم طويل في العينة لترى الحقل محاطًا بإطار أحمر. إذا أمكن احتواء النص بحجم خط أصغر ضمن النطاق المدعوم، فسترى الحجم المطلوب. عدّل القيمة أو غيّر الحد الأدنى للحجم وأعد الفحص. تُصدَّر ملفات PDF للصفوف التي تجتاز الفحص.',
    ],
    faq: [
      ['هل تُرفع ملفاتي إلى خادم؟', 'تُقرأ ملفات النموذج والجدول وتُعالج داخل متصفحك. تُنزَّل النتائج من المتصفح بعد التصدير.'],
      ['هل تقبل الأداة نموذجًا ممسوحًا ضوئيًا؟', 'تحتاج الأداة إلى نموذج AcroForm يحتوي على حقول تفاعلية قابلة للتعبئة. الصور الممسوحة ضوئيًا بلا حقول ونماذج XFA والملفات الموقّعة أو المشفّرة خارج نطاق الدعم.'],
    ],
    links: [
      ['/', 'واجهة العمل بالإنجليزية'],
      ['/privacy-and-proof', 'دليل الخصوصية والنماذج المدعومة بالإنجليزية'],
    ],
  },
  {
    path: '/preserve-leading-zeros-pdf',
    title: 'Preserve Leading Zeros in PDF IDs | ArabiForm',
    description: 'Keep IDs like 00123 and 00007 as text when filling PDF forms. Learn how to prepare CSV and Excel columns and review numeric-cell warnings.',
    heading: 'Preserve leading zeros when filling PDF forms',
    summary: 'Keep roster IDs such as 00123 and 00007 as text from the input column to the PDF field. Review Excel warnings before exporting.',
    guide: 'Prepare your ID column',
    paragraphs: [
      'In a CSV file, keep IDs written out as text, for example 00123. In Excel, format the column as Text before entering or pasting the original IDs. Then map it to the corresponding AcroForm text field.',
      'Excel may already have converted an entry to a number or scientific notation. Check the import warning and verify the original value before continuing. If digits or leading zeros were lost, correct the row using the original ID.',
    ],
    faq: [
      ['Will an ID stored as 00123 stay 00123?', 'Yes. ArabiForm preserves the leading zeros in a CSV value written as 00123 or an .xlsx cell stored as that text when filling a mapped text field.'],
      ['Can ArabiForm recover zeros that are already missing?', 'Recover the full ID from your source records and edit the imported row or replace the cell with the original text. A numeric value such as 7 does not specify how many zeros the original ID had.'],
    ],
    links: [
      ['/', 'Map an ID column in the workbench'],
      ['/arabic-pdf-form-filler', 'Preview mixed Arabic and Latin values'],
    ],
  },
  {
    path: '/privacy-and-proof',
    title: 'Local PDF Processing, Privacy & Proof | ArabiForm',
    description: 'Check what runs inside your browser, try a synthetic PDF and roster, and see which AcroForm templates ArabiForm supports.',
    heading: 'Check privacy and PDF support',
    summary: 'ArabiForm reads and processes the files you choose inside your browser. Use the Synthetic Arabic Sample to inspect a filled page and a preflight warning with fictional data.',
    guide: 'What to check with the sample',
    paragraphs: [
      'Load the Synthetic Arabic Sample. Select a ready row to see Arabic text and a leading-zero ID in a filled PDF. Select the deliberately overlong row to see the warning. Shorten its name and compare the preview after the row passes preflight.',
      'To check network behavior, open the Network panel in browser developer tools before loading the sample. Page assets and the PDF worker come from the site itself. The production response header contains the Content Security Policy directive connect-src \'none\', which blocks connections such as fetch and XMLHttpRequest.',
      'ArabiForm fills mapped text fields, checkboxes, dropdowns and radio buttons in ordinary AcroForm PDFs. Unmapped fields keep their original values and appearances in editable copies. The flattened ZIP option writes the field appearances into the pages for printing. XFA, encrypted, signed, and flat PDFs are outside the supported scope.',
    ],
    faq: [
      ['Does choosing a file upload it to the site?', 'The file picker passes the contents to your browser for local processing. The workbench creates the preview and export files on the same device.'],
      ['How do I spot a field that needs review?', 'Check the preflight table for flagged rows and select a row to see its fields in the preview. Verify the corrected row before downloading the passing PDFs.'],
    ],
    links: [
      ['/', 'Try the sample in the workbench'],
      ['/preserve-leading-zeros-pdf', 'Prepare text IDs for a PDF batch'],
    ],
  },
]

const project = fileURLToPath(new URL('../', import.meta.url))
const dist = join(project, 'dist')
const site = new URL(process.env.SITE_URL ?? 'https://arabiform.example')
if (!['https:', 'http:'].includes(site.protocol) || site.href !== `${site.origin}/`) {
  throw new Error('SITE_URL must be an HTTP(S) origin without a path, query, or fragment')
}

const template = await readFile(join(dist, 'index.html'), 'utf8')
const metaMarker = '<!-- ARABIFORM_META -->'
const contentMarker = '<!-- ARABIFORM_CONTENT -->'
const defaultLanguage = '<html lang="en" dir="ltr">'
const titleTag = /<title>[^<]*<\/title>/
if (!template.includes(metaMarker) || !template.includes(contentMarker) ||
    !template.includes(defaultLanguage) || !titleTag.test(template)) {
  throw new Error('Vite output is missing the ArabiForm prerender template markers')
}

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (value) => value.replace(/[&<>"]/g, (character) => entities[character])

function structuredData(data) {
  const json = JSON.stringify({ '@context': 'https://schema.org', ...data }).replace(/</g, '\\u003c')
  return `<script type="application/ld+json">${json}</script>`
}

function inkSpecimen(lang) {
  const names = 'بَنِي يَمَن / سَلْمَى بِنْت يَاسِين'
  const copy = lang === 'ar' ? {
    caption: 'من العينة الاصطناعية «بَنِي يَمَن» و«سَلْمَى بِنْت يَاسِين»',
    legend: 'قارن موضع النص داخل الحقل',
    naive: 'تموضع تقليدي (مع قصّ)',
    bounds: 'فحص حدود الحروف في ArabiForm (بلا قصّ)',
    clipped: 'رسم توضيحي يبيّن كيف تُقصّ أجزاء من الحروف والتشكيل عند حدود الحقل.',
    fitted: 'رسم توضيحي يبيّن كيف يتّسع الحقل لكامل الحروف والتشكيل.',
  } : {
    caption: 'Synthetic specimen: ' + names,
    legend: 'Compare text placement in the field',
    naive: 'Naive baseline (clipped)',
    bounds: 'ArabiForm ink-bounds (0 clipped)',
    clipped: 'Illustration: the field cuts off parts of the letters and diacritics.',
    fitted: 'Illustration: the letters and diacritics fit inside the field.',
  }
  return `<figure class="ink-specimen" data-testid="ink-specimen">
    <figcaption>${escapeHtml(copy.caption)}</figcaption>
    <fieldset class="ink-comparison">
      <legend class="sr-only">${escapeHtml(copy.legend)}</legend>
      <label class="ink-mode">
        <input type="radio" name="ink-mode" value="naive" data-testid="ink-mode-naive" checked>
        <span>${escapeHtml(copy.naive)}</span>
      </label>
      <label class="ink-mode">
        <input type="radio" name="ink-mode" value="bounds" data-testid="ink-mode-bounds">
        <span>${escapeHtml(copy.bounds)}</span>
      </label>
      <div class="ink-field" data-testid="ink-field" aria-hidden="true">
        <span class="ink-frame"><span class="ink-glyphs" lang="ar" dir="rtl">${names}</span></span>
      </div>
      <p class="ink-note ink-note-naive">${escapeHtml(copy.clipped)}</p>
      <p class="ink-note ink-note-bounds">${escapeHtml(copy.fitted)}</p>
    </fieldset>
  </figure>`
}

async function writeRoute(route) {
  const lang = route.lang ?? 'en'
  const canonical = `${site.origin}${route.path}`
  const metadata = [
    `<meta name="description" content="${escapeHtml(route.description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    structuredData({
      '@type': 'FAQPage',
      inLanguage: lang,
      mainEntity: route.faq.map(([name, text]) => ({
        '@type': 'Question',
        name,
        acceptedAnswer: { '@type': 'Answer', text },
      })),
    }),
    structuredData({
      '@type': 'SoftwareApplication',
      name: 'ArabiForm',
      url: `${site.origin}/`,
      inLanguage: lang,
      description: route.description,
      applicationCategory: 'BusinessApplication',
    }),
  ].join('\n    ')

  const paragraphs = route.paragraphs.map((copy) => `<p>${escapeHtml(copy)}</p>`).join('\n')
  const faq = route.faq.map(([question, answer]) =>
    `<dt>${escapeHtml(question)}</dt><dd>${escapeHtml(answer)}</dd>`).join('\n')
  const links = route.links.map(([path, label, language]) =>
    `<li><a href="${path}"${language ? ` lang="${language}"` : ''}>${escapeHtml(label)}</a></li>`).join('\n')
  const content = `<section data-route-content>
  <h1>${escapeHtml(route.heading)}</h1>
  <p data-route-summary>${escapeHtml(route.summary)}</p>
  <div data-route-details>
    <h2>${escapeHtml(route.guide)}</h2>
    ${route.inkSpecimen ? inkSpecimen(lang) : ''}
    ${paragraphs}
    <h3>${lang === 'ar' ? 'أسئلة شائعة' : 'Frequently asked questions'}</h3>
    <dl>${faq}</dl>
    <ul>${links}</ul>
  </div>
</section>`

  const html = template
    .replace(defaultLanguage, `<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`)
    .replace(titleTag, () => `<title>${escapeHtml(route.title)}</title>`)
    .replace(metaMarker, () => metadata)
    .replace(contentMarker, () => content)
  const directory = join(dist, route.path.slice(1))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.html'), html)
}

const headers = `/*
  Content-Security-Policy: default-src 'self'; connect-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; font-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map(({ path }) => `  <url><loc>${escapeHtml(`${site.origin}${path}`)}</loc></url>`).join('\n')}
</urlset>
`

// Preserve the relative links inside the unchanged notices file.
await mkdir(join(dist, 'public/fonts'), { recursive: true })
const notices = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'public/fonts/NotoNaskhArabic-OFL.txt', 'public/fonts/NotoSans-OFL.txt']
await Promise.all([
  ...routes.map(writeRoute),
  writeFile(join(dist, '_headers'), headers),
  writeFile(join(dist, 'sitemap.xml'), sitemap),
  writeFile(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site.origin}/sitemap.xml\n`),
  ...notices.map((path) => copyFile(join(project, path), join(dist, path))),
])
