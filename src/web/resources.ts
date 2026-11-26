export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

export function errorCode(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return 'code' in error && typeof error.code === 'string' ? error.code : error.message;
}

export function saveDownload(data: Uint8Array | string, name: string, type: string) {
  const part = typeof data === 'string' ? data
    : data.buffer instanceof ArrayBuffer && data.byteLength === data.buffer.byteLength ? data.buffer
    : Uint8Array.from(data);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

let bundledFonts: Promise<{ arabic: Uint8Array<ArrayBuffer>; latin: Uint8Array<ArrayBuffer> }> | undefined;

export function loadFonts() {
  bundledFonts ??= import('virtual:arabiform/fonts').then((assets) => ({
    arabic: decodeBase64(assets.arabic),
    latin: decodeBase64(assets.latin),
  }));
  return bundledFonts;
}
