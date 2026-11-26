export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

let bundledFonts: Promise<{ arabic: Uint8Array<ArrayBuffer>; latin: Uint8Array<ArrayBuffer> }> | undefined;

export function loadFonts() {
  bundledFonts ??= import('virtual:arabiform/fonts').then(async (assets) => {
    const arabic = decodeBase64(assets.arabic);
    const latin = decodeBase64(assets.latin);
    const faces = await Promise.all([
      new FontFace('Workbench Naskh', arabic).load(),
      new FontFace('Workbench Sans', latin).load(),
    ]);
    faces.forEach((face) => document.fonts.add(face));
    return { arabic, latin };
  });
  return bundledFonts;
}
