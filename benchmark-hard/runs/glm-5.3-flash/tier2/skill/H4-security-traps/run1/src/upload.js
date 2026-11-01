// Photo upload handling. Type is decided by magic bytes, never by the
// client-supplied filename or MIME header. Stored name is server-generated
// (32 hex chars + .png/.jpg), so client paths never touch the filesystem.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

const SIGNATURES = [
  {
    mime: "image/png",
    ext: "png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
];

export function sniffImage(buffer) {
  for (const sig of SIGNATURES) {
    if (sig.test(buffer)) return { mime: sig.mime, ext: sig.ext };
  }
  return null;
}

export function storePhoto(db, buffer) {
  const kind = sniffImage(buffer);
  if (!kind) return null;
  const storedName = crypto.randomBytes(16).toString("hex") + "." + kind.ext;
  fs.writeFileSync(path.join(db.uploadsDir, storedName), buffer);
  return { storedName, mime: kind.mime };
}

export function deletePhoto(db, photo) {
  if (!photo) return;
  if (!isStoredPhotoName(photo.storedName)) return; // never unlink anything our naming scheme did not create
  const file = path.join(db.uploadsDir, photo.storedName);
  fs.rmSync(file, { force: true });
}

// Only names this module generated may be served from the uploads directory.
export function isStoredPhotoName(name) {
  return typeof name === "string" && /^[a-f0-9]{32}\.(png|jpg)$/.test(name);
}
