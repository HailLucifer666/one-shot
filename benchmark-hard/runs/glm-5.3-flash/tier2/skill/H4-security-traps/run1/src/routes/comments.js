// Comment routes. Posting requires a signed-in session; deleting a comment is
// admin-only per spec (authors cannot delete their own comments either).
import express from "express";

import { findComment, findRecipe, nextId } from "../db.js";
import { requireUser } from "../auth.js";
import { renderError } from "../views.js";
import { validateComment } from "../validators.js";

export function commentsRouter() {
  const router = express.Router();

  router.post("/recipes/:id/comments", requireUser, (req, res) => {
    const db = req.app.locals.db;
    const recipe = findRecipe(db.state, req.params.id);
    if (!recipe) {
      return res.status(404).send(renderError(404, "Recipe not found", "This recipe may have been deleted.", req.user));
    }
    const result = validateComment(req.body);
    if (!result.ok) {
      return res.status(400).send(renderError(400, "Comment problem", result.error, req.user));
    }
    db.state.comments.push({
      id: nextId(),
      recipeId: recipe.id,
      authorId: req.user.id,
      body: result.value,
      createdAt: new Date().toISOString(),
    });
    db.save();
    return res.redirect(`/recipes/${recipe.id}`);
  });

  router.post("/comments/:id/delete", requireUser, (req, res) => {
    const db = req.app.locals.db;
    const comment = findComment(db.state, req.params.id);
    if (!comment) {
      return res.status(404).send(renderError(404, "Comment not found", "This comment may have been deleted.", req.user));
    }
    if (req.user.role !== "admin") {
      return res.status(403).send(renderError(403, "Not allowed", "Only an admin can delete comments.", req.user));
    }
    db.state.comments = db.state.comments.filter((c) => c.id !== comment.id);
    db.save();
    return res.redirect(`/recipes/${comment.recipeId}`);
  });

  return router;
}
