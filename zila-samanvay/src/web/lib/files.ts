// Evidence upload helper: photos are resized (max 1600 px) and re-encoded to WebP in the
// browser before upload, so evidence works on 2G/3G field connections. PDFs pass through.

export interface EvidencePayload {
  fileName: string;
  mime: 'image/webp' | 'image/jpeg' | 'image/png' | 'application/pdf';
  dataUrl: string;
  size: number;
}

const MAX_BYTES = 2_500_000;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });
}

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.8));
  return blob ?? file;
}

export async function readEvidence(file: File): Promise<EvidencePayload> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) throw new Error('Upload a photo (JPG / PNG / WebP) or a PDF.');
  let blob: Blob = file;
  let mime: EvidencePayload['mime'] = isPdf ? 'application/pdf' : 'image/webp';
  let name = file.name;
  if (isImage) {
    blob = await compressImage(file);
    if (blob.type !== 'image/webp') mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    else name = name.replace(/\.[a-z0-9]+$/i, '') + '.webp';
  }
  if (blob.size > MAX_BYTES) throw new Error('File is larger than 2.5 MB after compression. Use a smaller photo or PDF.');
  let dataUrl = await readAsDataUrl(blob);
  // normalise the declared type so the server can match it
  dataUrl = dataUrl.replace(/^data:[^;]*;base64,/, `data:${mime};base64,`);
  return { fileName: name, mime, dataUrl, size: blob.size };
}

/** Trigger a browser download for generated text (CSV etc.). */
export function downloadText(fileName: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
