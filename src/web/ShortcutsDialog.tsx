import { useLayoutEffect, useRef } from 'react';

const en = {
  title: 'Keyboard shortcuts',
  close: 'Close',
  help: 'Open keyboard shortcuts when you are outside a form field.',
  search: 'Focus row search when the workbench queue is available.',
  escape: 'Close this dialog or cancel edits in the workbench row editor. Focus returns to the control you used.',
  arrows: 'Move through matching rows and update the preview while the workbench queue table has focus.',
  characterKeys: 'Enable single-character shortcuts on this page',
};

const ar: typeof en = {
  title: 'اختصارات لوحة المفاتيح',
  close: 'إغلاق',
  help: 'افتح اختصارات لوحة المفاتيح عندما يكون التركيز خارج حقول الإدخال.',
  search: 'انقل التركيز إلى حقل البحث عند ظهور قائمة الصفوف في مساحة العمل.',
  escape: 'أغلق هذه النافذة أو ألغِ تعديلات الصف في مساحة العمل. يعود التركيز إلى زر الفتح أو التعديل.',
  arrows: 'تنقّل بين الصفوف المطابقة وحدّث المعاينة عندما يكون التركيز داخل الجدول في مساحة العمل.',
  characterKeys: 'فعّل اختصارات المفاتيح المفردة في هذه الصفحة',
};

type ShortcutsDialogProps = {
  arabic: boolean;
  characterKeys: boolean;
  onChangeCharacterKeys: (enabled: boolean) => void;
  onClose: () => void;
};

export default function ShortcutsDialog({ arabic, characterKeys, onChangeCharacterKeys, onClose }: ShortcutsDialogProps) {
  const copy = arabic ? ar : en;
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const setting = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    dialog.current?.showModal();
    close.current?.focus();
  }, []);

  function dismiss() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog ref={dialog} className="shortcuts-dialog" aria-labelledby="shortcuts-heading"
      data-testid="shortcuts-dialog"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const first = event.shiftKey ? setting.current : close.current;
        const last = event.shiftKey ? close.current : setting.current;
        if (event.target !== last) return;
        event.preventDefault();
        first?.focus();
      }}>
      <header>
        <h2 id="shortcuts-heading">{copy.title}</h2>
        <button ref={close} type="button" className="button secondary" data-testid="shortcuts-close"
          onClick={dismiss}>{copy.close}</button>
      </header>
      <dl className="shortcuts-list">
        <div><dt><kbd dir="ltr">?</kbd>{arabic && <> <kbd>؟</kbd></>}</dt><dd>{copy.help}</dd></div>
        <div><dt><kbd dir="ltr">/</kbd></dt><dd>{copy.search}</dd></div>
        <div><dt><kbd dir="ltr">Esc</kbd></dt><dd>{copy.escape}</dd></div>
        <div>
          <dt><kbd aria-label={arabic ? 'سهم لأعلى' : 'Up arrow'}>↑</kbd> <kbd aria-label={arabic ? 'سهم لأسفل' : 'Down arrow'}>↓</kbd></dt>
          <dd>{copy.arrows}</dd>
        </div>
      </dl>
      <label className="output-mode shortcuts-setting">
        <input ref={setting} type="checkbox" data-testid="shortcuts-single-character" checked={characterKeys}
          onChange={(event) => onChangeCharacterKeys(event.currentTarget.checked)} />
        <span>{copy.characterKeys}</span>
      </label>
    </dialog>
  );
}
