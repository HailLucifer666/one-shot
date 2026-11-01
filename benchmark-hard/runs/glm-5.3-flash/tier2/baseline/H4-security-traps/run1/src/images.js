// Photo content checks. The uploaded bytes are identified by their magic
// number, never by the filename or the browser-supplied content type, so a
// renamed HTML or SVG file cannot masquerade as a picture.

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null;
  if (buffer.subarray(0, 3).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  return null;
}

export function extensionForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  throw new Error(`Unsupported image type: ${mime}`);
}
