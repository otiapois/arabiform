export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

let bundledFonts: Promise<{ arabic: Uint8Array<ArrayBuffer>; latin: Uint8Array<ArrayBuffer> }> | undefined;

export function loadFonts() {
  bundledFonts ??= import('virtual:arabiform/fonts').then((assets) => ({
    arabic: decodeBase64(assets.arabic),
    latin: decodeBase64(assets.latin),
  }));
  return bundledFonts;
}
