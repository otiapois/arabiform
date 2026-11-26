export interface FieldChoice {
  value: string;
  label: string;
}

export function matchChoice(choices: readonly FieldChoice[], value: string): number | undefined {
  let exact: number | undefined;
  let trimmed: number | undefined;
  let ambiguousTrim = false;
  const token = value.trim();
  for (const [index, choice] of choices.entries()) {
    if (choice.value === value || choice.label === value) {
      if (exact !== undefined) return undefined;
      exact = index;
    }
    if (choice.value.trim() === token || choice.label.trim() === token) {
      if (trimmed !== undefined) ambiguousTrim = true;
      trimmed = index;
    }
  }
  return exact ?? (ambiguousTrim ? undefined : trimmed);
}
