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
