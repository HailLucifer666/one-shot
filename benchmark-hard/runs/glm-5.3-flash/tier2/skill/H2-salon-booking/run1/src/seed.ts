import type { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { STYLISTS } from "./salon.ts";

export type SeedConfig = {
  adminEmail: string;
  adminPassword: string;
  stylistPassword: string;
};

/**
 * Idempotent demo seed: one admin account and one login account per stylist.
 * These are documented demo credentials (README / .env.example), overridable
 * via environment variables — the app holds no other secrets.
 */
export function ensureSeed(db: DatabaseSync, config: SeedConfig): void {
  const insertUser = db.prepare(
    "INSERT INTO users (email, password_hash, name, role, created_at_utc) VALUES (?, ?, ?, ?, ?)",
  );
  const insertStylist = db.prepare("INSERT INTO stylists (id, user_id, name, active) VALUES (?, ?, ?, 1)");

  const userByEmail = db.prepare("SELECT id FROM users WHERE email = ?");
  const stylistById = db.prepare("SELECT id FROM stylists WHERE id = ?");

  if (!userByEmail.get(config.adminEmail)) {
    insertUser.run(
      config.adminEmail,
      bcrypt.hashSync(config.adminPassword, 10),
      "Salon admin",
      "admin",
      new Date().toISOString(),
    );
  }

  for (const stylist of STYLISTS) {
    const email = `${stylist.name.toLowerCase()}@cutwell.test`;
    let userId = (userByEmail.get(email) as { id: number } | undefined)?.id;
    if (userId === undefined) {
      const result = insertUser.run(
        email,
        bcrypt.hashSync(config.stylistPassword, 10),
        stylist.name,
        "stylist",
        new Date().toISOString(),
      );
      userId = Number(result.lastInsertRowid);
    }
    if (!stylistById.get(stylist.id)) {
      insertStylist.run(stylist.id, userId, stylist.name);
    }
  }
}
