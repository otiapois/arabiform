import oldTemplate from '../../fixtures/m23/2026-offer.pdf?url&inline';
import newTemplate from '../../fixtures/m23/2027-offer.pdf?url&inline';
import preset from '../../fixtures/m23/offer-preset-v11.json?raw';
import { decodeBase64 } from './resources';

export function loadCompareDemo() {
  return {
    old: { file: new File([decodeBase64(oldTemplate.slice(oldTemplate.indexOf(',') + 1))], '2026-offer.pdf', { type: 'application/pdf' }), synthetic: true },
    next: { file: new File([decodeBase64(newTemplate.slice(newTemplate.indexOf(',') + 1))], '2027-offer.pdf', { type: 'application/pdf' }), synthetic: true },
    preset: { file: new File([preset], 'offer-preset-v11.json', { type: 'application/json' }), synthetic: true },
  };
}
