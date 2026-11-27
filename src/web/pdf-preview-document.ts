import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export function openPreviewDocument(bytes: Uint8Array) {
  return getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    useWorkerFetch: false,
    useWasm: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    enableXfa: false,
  });
}
