declare module 'bidi-js' {
  export default function createBidi(): {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] };
    getMirroredCharacter(character: string): string | null;
  };
}
