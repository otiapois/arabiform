import { matchChoice, type FieldChoice } from '../core/pdf/choice-match';

export function editableChoices(choices: readonly FieldChoice[]) {
  return choices.flatMap((choice, index) => {
    const input = [choice.value, choice.label].find((value) => matchChoice(choices, value) === index);
    return input === undefined ? [] : [{ choice, index, input }];
  });
}

export function choiceText({ label, value }: FieldChoice, blank: string) {
  return label && label !== value ? `${label} · ${value || blank}` : value || blank;
}

export function ChoiceList({ choices, label, blank }: {
  choices: readonly FieldChoice[];
  label: string;
  blank: string;
}) {
  return (
    <ul className="choice-list" aria-label={label}>
      {choices.map((choice, index) => (
        <li key={index}>
          <bdi dir="auto">{choice.label || choice.value || blank}</bdi>
          {choice.label && choice.value !== choice.label && <> · <bdi dir="auto">{choice.value || blank}</bdi></>}
        </li>
      ))}
    </ul>
  );
}
