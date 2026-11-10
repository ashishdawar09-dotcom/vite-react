// Shrinks a chosen photo on the phone before it's sent: at most 1200 px on
// the long edge, saved as a JPEG. Drawing it onto a canvas also leaves out
// everything stored inside the original file (camera details, location).
// Browsers apply the photo's rotation when they draw it, so a portrait taken
// on a phone stays upright.

export const MAX_EDGE = 1200;
export const JPEG_QUALITY = 0.86;
/** The function refuses anything over 3 MB; a 1200 px JPEG is far below that. */
export const MAX_UPLOAD_BYTES = 3_000_000;

/** The size to draw at: the same shape, no edge longer than `max`, never enlarged. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  if (w <= max && h <= max) return { w: Math.round(w), h: Math.round(h) };
  const k = max / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Bytes a base64 data URL decodes to. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export type ShrunkPhoto = { dataUrl: string; width: number; height: number; bytes: number };

/** Reads the file as a picture, or explains why not (a HEIC photo on a desktop browser, a PDF, a broken file). */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/") && file.type !== "") { reject(new Error("not-image")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    img.src = url;
  });
}

export async function shrinkPhoto(file: File): Promise<ShrunkPhoto> {
  const img = await loadImage(file);
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight);
  if (!w || !h) throw new Error("unreadable");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("unreadable");
  // A transparent PNG gets a white background, as a JPEG has no transparency.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("unreadable");
  const bytes = dataUrlBytes(dataUrl);
  if (bytes > MAX_UPLOAD_BYTES) throw new Error("too-big");
  return { dataUrl, width: w, height: h, bytes };
}
