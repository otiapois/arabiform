const en = {
  kindText: 'Text',
  kindCheckbox: 'Checkbox',
  kindRadio: 'Radio buttons',
  kindDropdown: 'Dropdown',
  allowedChoices: 'Allowed choices',
  blankChoice: 'Blank',
  selected: 'Selected row {row}',
  pdfError: 'The batch could not be checked with these settings.',
};

const ar: typeof en = {
  kindText: 'نص',
  kindCheckbox: 'مربع اختيار',
  kindRadio: 'أزرار اختيار',
  kindDropdown: 'قائمة منسدلة',
  allowedChoices: 'الخيارات المتاحة',
  blankChoice: 'فارغ',
  selected: 'الصف المحدد: {row}',
  pdfError: 'تعذّر فحص الدفعة بهذه الإعدادات.',
};

export const activeFillLabels = (arabic: boolean) => arabic ? ar : en;
