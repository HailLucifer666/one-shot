import type { SessionUser } from "./auth.ts";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser | null;
  }
}
