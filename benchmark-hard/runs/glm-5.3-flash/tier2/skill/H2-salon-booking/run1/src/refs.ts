import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Unambiguous 31-character alphabet (no 0/O, 1/I/L). A reference looks like
 * CW-7K2M9P. Uniqueness is checked against the database with retries.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function refFormatOk(ref: string): boolean {
  return /^CW-[2-9A-HJ-NP-Z]{6}$/.test(ref);
}

export function generateRef(db: DatabaseSync): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = randomBytes(6);
    let code = "";
    let taken = 0;
    for (const byte of bytes) {
      if (taken >= 6) break;
      code += ALPHABET[byte % ALPHABET.length];
      taken++;
    }
    const ref = `CW-${code}`;
    const existing = db.prepare("SELECT 1 FROM bookings WHERE ref = ?").get(ref);
    if (!existing) return ref;
  }
  throw new Error("Could not generate a unique booking reference");
}
