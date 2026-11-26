import { expect, it } from 'vitest';
import { editableChoices } from '../../src/web/Choices';

it('uses exact legal exports or falls back to a unique label for colliding options', () => {
  const choices = [
    { value: 'AR', label: 'الرياض' },
    { value: 'RIY', label: 'AR' },
    { value: 'duplicate', label: 'duplicate' },
    { value: 'duplicate', label: 'duplicate' },
    { value: '', label: 'Empty' },
  ];
  expect(editableChoices(choices).map(({ index, input }) => [index, input])).toEqual([
    [0, 'الرياض'], [1, 'RIY'], [4, ''],
  ]);
});
