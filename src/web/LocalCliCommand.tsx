import { useRef, useState } from 'react';
import type { useWorkbench } from './useWorkbench';
import './local-cli-command.css';

const en = {
  setup: 'Run this from your local ArabiForm checkout with the npm bundled with Node.js. Replace the example PDF, roster, and output paths.',
  preset: 'Choose the PDF and roster and use Export mapping preset. Update the JSON path if needed and export a fresh preset after changing settings.',
  blocked: 'Resolve the current worksheet, grouping, mapping, or print settings before using this command.',
  scope: 'The command checks the entire source roster and writes PDFs only if all rows pass. Apply any browser edits to your source roster first.',
  tabOnly: 'Custom fonts and source fingerprints on the cover are tab settings. The mapping preset does not carry them to the CLI.',
  date: 'For a future run, update or remove the date to control date-based values.',
  command: 'Fill command',
  sheet: 'Worksheet',
  grouping: 'Group by',
  copy: 'Copy command',
  copied: 'Command copied.',
  copyFailed: 'Clipboard unavailable. The command is selected for manual copying.',
};

const ar: typeof en = {
  setup: 'شغّل الأمر من مجلد مشروع ArabiForm على جهازك باستخدام npm المرفق مع Node.js، واستبدل مسارات القالب والجدول ومجلد النتائج.',
  preset: 'اختر ملف PDF والجدول ثم اضغط «صدّر إعدادات الربط». عدّل مسار ملف JSON عند الحاجة، وصدّر ملف إعدادات جديدًا بعد كل تغيير.',
  blocked: 'صحّح ورقة العمل أو التجميع أو ربط الحقول أو إعدادات الطباعة قبل تشغيل هذا الأمر.',
  scope: 'يفحص الأمر جميع صفوف الجدول الأصلي، ويُنشئ ملفات PDF فقط إذا اجتازت جميع الصفوف الفحص. طبّق تعديلات المتصفح على الجدول الأصلي أولًا.',
  tabOnly: 'تبقى الخطوط المخصصة وبصمات ملفات المصدر على الغلاف ضمن إعدادات علامة التبويب، ولا ينقلها ملف إعدادات الربط إلى سطر الأوامر.',
  date: 'في الدفعات المقبلة، غيّر التاريخ أو احذفه لتحديد كيفية حساب القيم المعتمدة على التاريخ.',
  command: 'أمر التعبئة',
  sheet: 'ورقة العمل',
  grouping: 'التجميع حسب',
  copy: 'انسخ الأمر',
  copied: 'تم نسخ الأمر.',
  copyFailed: 'تعذّر الوصول إلى الحافظة. حُدّد نص الأمر لنسخه يدويًا.',
};

function nameArgument(flag: '--sheet' | '--group-by', value: string): string {
  // Bare arguments must survive both POSIX shells and the Windows npm.cmd wrapper.
  if (/^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_.-]/.test(value)) return `${flag} ${value}`;
  const bytes = Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join('');
  const encoded = btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${flag}-base64url ${encoded}`;
}

export default function LocalCliCommand({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const labels = arabic ? ar : en;
  const sourceDate = desk.roster?.localDate;
  const sheetName = desk.roster?.sheetName;
  const groupBy = desk.groupByColumn;
  const command = [
    'npm run arabiform-cli -- --mode fill --template template.pdf',
    sheetName === undefined ? '--roster roster.csv' : '--roster roster.xlsx',
    '--preset arabiform-mapping-preset.json --out-dir output',
    sheetName ? nameArgument('--sheet', sheetName) : undefined,
    `--imposition ${desk.printLayout === '2-up' ? '2-up' : '1-up'}`,
    groupBy ? nameArgument('--group-by', groupBy) : undefined,
    desk.includeCoverSheet ? '--cover' : undefined,
    sourceDate?.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(sourceDate) ? `--date ${sourceDate}` : undefined,
    '--strict',
  ].filter(Boolean).join(' ');
  const commandField = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState<{ command: string; text: string }>();

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setNotice({ command, text: labels.copied });
    } catch {
      commandField.current?.focus();
      commandField.current?.select();
      setNotice({ command, text: labels.copyFailed });
    }
  }

  return (
    <div className="cli-command-content">
      <p className="quiet">{labels.setup}</p>
      <p className="quiet">{labels.preset}</p>
      {arabic && desk.includeCoverSheet && desk.coverLanguage === 'auto' && <p className="quiet">
        يستخدم الأمر الإنجليزية للغلاف عند اختيار «لغة واجهة التطبيق». اختر «العربية» أو «ثنائي اللغة» قبل تصدير إعدادات الربط.
      </p>}
      {(desk.roster?.sheetError || desk.groupingBlocked || desk.printSettingsBlocked || desk.virtualTemplateBlocked) && (
        <p className="alert" role="status">{labels.blocked}</p>
      )}
      {(sheetName || groupBy) && <p className="quiet">
        {sheetName && <span>{labels.sheet}{' '}<bdi dir="auto">{sheetName}</bdi></span>}
        {sheetName && groupBy && ' · '}
        {groupBy && <span>{labels.grouping}{' '}<bdi dir="auto">{groupBy}</bdi></span>}
      </p>}
      <label className="full-control">
        {labels.command}
        <textarea ref={commandField} data-testid="cli-command-code" readOnly spellCheck={false} dir="ltr" lang="en" rows={5} value={command} />
      </label>
      <div className="actions compact">
        <button type="button" className="button secondary" data-testid="cli-command-copy" onClick={() => void copyCommand()}>{labels.copy}</button>
      </div>
      <p className="quiet cli-command-status" role="status" data-testid="cli-command-status">{notice?.command === command ? notice.text : ''}</p>
      <p className="quiet">{labels.scope}</p>
      {(desk.customFont || desk.includeCustody) && <p className="quiet">{labels.tabOnly}</p>}
      {sourceDate && <p className="quiet">{labels.date}</p>}
    </div>
  );
}
