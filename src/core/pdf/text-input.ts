const arabicLetter = /(?=\p{L})\p{Script=Arabic}/u;
const joinControl = /[\u200c\u200d]/u;

export function textInputDiagnostic(value: string): 'unsupported-glyph' | 'unsupported-bidi' | undefined {
  const characters = Array.from(value);
  for (const [index, character] of characters.entries()) {
    if (joinControl.test(character)) {
      let before = index - 1;
      let after = index + 1;
      while (/\p{M}/u.test(characters[before] ?? '')) before--;
      while (/\p{M}/u.test(characters[after] ?? '')) after++;
      if (!arabicLetter.test(characters[before] ?? '') || !arabicLetter.test(characters[after] ?? '')) return 'unsupported-bidi';
    } else if (/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(character)) return 'unsupported-bidi';
    else if (/[\p{Cc}\p{Cs}]/u.test(character) && !/[\r\n\t]/u.test(character)) return 'unsupported-glyph';
  }
}
