// Reads .env (if present) into process.env once, then exposes resolved config.
// No dotenv dependency needed; values in the real environment always win.
import fs from "node:fs";
import path from "node:path";

export function loadEnvFile(cwd = process.cwd()) {
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
  adminEmail: process.env.ADMIN_EMAIL || "admin@recipebox.local",
  adminPassword: process.env.ADMIN_PASSWORD || "admin-password-123",
};
