import type { NextFunction, Request, Response } from "express";
import type { Role } from "./auth.ts";
import { esc, page } from "./render.ts";

/** Signs the user in if needed, then restricts to the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.redirect(303, "/login");
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).send(
        page({
          title: "Not allowed",
          user: req.user,
          content: `<h1>You do not have access to this page</h1>
            <p>Signed in as ${esc(req.user.name)} (${esc(req.user.role)}). This area is for ${roles.join(" and ")} accounts.</p>
            <p><a class="button-secondary" href="/">Back to the homepage</a></p>`,
        }),
      );
      return;
    }
    next();
  };
}

export function notFoundPage(res: Response, message = "The page you asked for does not exist."): void {
  res.status(404).send(
    page({
      title: "Not found",
      user: null,
      content: `<h1>Not found</h1><p>${esc(message)}</p><p><a class="button-secondary" href="/">Back to the homepage</a></p>`,
    }),
  );
}
