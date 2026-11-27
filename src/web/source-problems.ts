const problems: Record<string, readonly [string, string]> = {
  'xfa-unsupported': ['XFA forms are unsupported. Choose a PDF with standard AcroForm fields.', 'نماذج XFA غير مدعومة. اختر ملف PDF يحتوي على حقول AcroForm عادية.'],
  'encrypted-pdf': ['This PDF is encrypted. Choose an unlocked copy.', 'ملف PDF مشفّر. اختر نسخة غير مقفلة.'],
  'signed-pdf-warning': ['This PDF has a signature field. Choose an unsigned template without signature fields.', 'يحتوي ملف PDF على حقل توقيع. اختر قالبًا غير موقّع وخاليًا من حقول التوقيع.'],
  'flat-scanned-no-fields': ['No fillable text fields or checkboxes were found. Choose an editable AcroForm with text fields, checkboxes, dropdowns, or radio buttons.', 'لم يُعثر على حقول قابلة للتعبئة. اختر نموذج AcroForm يحتوي على حقول نصية أو مربعات اختيار أو قوائم منسدلة أو أزرار اختيار.'],
  'invalid-pdf': ['The PDF could not be read. Check the file and choose it again.', 'تعذّرت قراءة ملف PDF. تحقّق من الملف ثم اختره مجددًا.'],
  'unsupported-roster': ['Choose a CSV or an Excel .xlsx file.', 'اختر ملف CSV أو Excel بامتداد ‎.xlsx.'],
  'invalid-csv': ['The CSV could not be read. Check that each row uses the same columns.', 'تعذّرت قراءة ملف CSV. تأكّد من أن جميع الصفوف تتّبع الأعمدة نفسها.'],
  'invalid-xlsx': ['The Excel workbook could not be read. Save it as .xlsx and try again.', 'تعذّرت قراءة مصنف Excel. احفظه بامتداد ‎.xlsx وحاول مجددًا.'],
  'invalid-roster-headers': ['The first row must contain unique, nonempty column names.', 'يجب أن يحتوي الصف الأول على أسماء أعمدة فريدة وغير فارغة.'],
};

export function sourceProblem(code: string, arabic: boolean) {
  return problems[code]?.[arabic ? 1 : 0];
}
