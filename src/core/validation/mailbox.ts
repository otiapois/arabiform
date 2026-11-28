const headerControl = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;
const dotAtom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function isSingleMailbox(value: string): boolean {
  if (value.length > 254 || headerControl.test(value)) return false;
  const [local, domain, extra] = value.split('@');
  if (local === undefined || domain === undefined || extra !== undefined || local.length > 64 || !dotAtom.test(local)) return false;
  const labels = domain.split('.');
  return labels.length > 1 && /[a-z]/i.test(labels.at(-1)!) && labels.every((label) => dnsLabel.test(label));
}
