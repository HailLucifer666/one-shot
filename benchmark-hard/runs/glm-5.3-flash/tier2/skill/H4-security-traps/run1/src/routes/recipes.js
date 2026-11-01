// Recipe routes: list detail, create/edit/delete with photo handling, photo
// serving. All authorization checks happen here, on the server, per request.
import express from "express";
import multer from "multer";

import { findRecipe, findUser, nextId } from "../db.js";
import { requireUser } from "../auth.js";
import { renderError, renderRecipe, renderRecipeForm } from "../views.js";
import { validateRecipeFields } from "../validators.js";
import { upload, storePhoto, deletePhoto, MAX_PHOTO_BYTES } from "../upload.js";
import { rateLimit } from "../ratelimit.js";
import { summarizeRecipeText } from "../llm.js";

function getRecipeOr404(req, res) {
  const db = req.app.locals.db;
  const recipe = findRecipe(db.state, req.params.id);
  if (!recipe) {
    res.status(404).send(renderError(404, "Recipe not found", "This recipe may have been deleted.", req.user));
    return null;
  }
  return recipe;
}

function isOwner(user, recipe) {
  return Boolean(user && user.id === recipe.ownerId);
}

function canDelete(user, recipe) {
  return isOwner(user, recipe) || Boolean(user && user.role === "admin");
}

// Wraps multer so size/type errors become friendly pages instead of a 500.
function uploadSingle(req, res, next) {
  upload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .send(renderError(413, "Photo too large", `Photos can be up to ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB.`, req.user));
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).send(renderError(400, "Upload problem", "We could not read that upload. Please try again.", req.user));
    }
    return next(err);
  });
}

function handlePhotoFor(db, req, existingRecipe = null) {
  // Returns { photo, error } — error is a user-facing message string.
  const wantsRemove = existingRecipe && req.body.removePhoto === "1";
  const hasNewFile = Boolean(req.file && req.file.buffer && req.file.buffer.length > 0);
  if (hasNewFile) {
    const stored = storePhoto(db, req.file.buffer);
    if (!stored) {
      return { error: "Photo must be a JPG or PNG image up to 2 MB." };
    }
    if (existingRecipe) deletePhoto(db, existingRecipe.photo);
    return { photo: stored };
  }
  if (wantsRemove) {
    deletePhoto(db, existingRecipe.photo);
    return { photo: null };
  }
  return { photo: existingRecipe ? existingRecipe.photo : null };
}

export function recipesRouter() {
  const router = express.Router();
  const summarizeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

  router.get("/new", requireUser, (req, res) => {
    res.send(renderRecipeForm({ user: req.user, mode: "new" }));
  });

  router.post("/", requireUser, uploadSingle, (req, res) => {
    const db = req.app.locals.db;
    const result = validateRecipeFields(req.body);
    const photoResult = result.ok ? handlePhotoFor(db, req) : { photo: null };
    if (!result.ok || photoResult.error) {
      const errors = [...result.errors, ...(photoResult.error ? [photoResult.error] : [])];
      return res.status(400).send(renderRecipeForm({ user: req.user, mode: "new", errors, values: result.values }));
    }
    const now = new Date().toISOString();
    const recipe = {
      id: nextId(),
      ownerId: req.user.id,
      title: result.values.title,
      ingredients: result.values.ingredients,
      steps: result.values.steps,
      photo: photoResult.photo,
      createdAt: now,
      updatedAt: now,
    };
    db.state.recipes.push(recipe);
    db.save();
    return res.redirect(`/recipes/${recipe.id}`);
  });

  router.get("/:id", (req, res) => {
    const db = req.app.locals.db;
    const recipe = getRecipeOr404(req, res);
    if (!recipe) return;
    const owner = findUser(db.state, recipe.ownerId);
    const comments = db.state.comments
      .filter((c) => c.recipeId === recipe.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => {
        const author = findUser(db.state, c.authorId);
        return { ...c, authorEmail: author ? author.email : "unknown" };
      });
    res.send(
      renderRecipe({
        user: req.user,
        recipe,
        ownerEmail: owner ? owner.email : "unknown",
        comments,
        summary: recipe.lastSummary || null,
      })
    );
  });

  router.get("/:id/edit", requireUser, (req, res) => {
    const recipe = getRecipeOr404(req, res);
    if (!recipe) return;
    if (!isOwner(req.user, recipe)) {
      return res.status(403).send(renderError(403, "Not allowed", "Only the recipe's owner can edit it.", req.user));
    }
    return res.send(renderRecipeForm({ user: req.user, mode: "edit", recipe, values: recipe }));
  });

  router.post("/:id/edit", requireUser, uploadSingle, (req, res) => {
    const db = req.app.locals.db;
    const recipe = getRecipeOr404(req, res);
    if (!recipe) return;
    if (!isOwner(req.user, recipe)) {
      return res.status(403).send(renderError(403, "Not allowed", "Only the recipe's owner can edit it.", req.user));
    }
    const result = validateRecipeFields(req.body);
    const photoResult = result.ok ? handlePhotoFor(db, req, recipe) : { photo: recipe.photo };
    if (!result.ok || photoResult.error) {
      const errors = [...result.errors, ...(photoResult.error ? [photoResult.error] : [])];
      return res
        .status(400)
        .send(renderRecipeForm({ user: req.user, mode: "edit", recipe, errors, values: { ...recipe, ...result.values } }));
    }
    recipe.title = result.values.title;
    recipe.ingredients = result.values.ingredients;
    recipe.steps = result.values.steps;
    recipe.photo = photoResult.photo;
    recipe.updatedAt = new Date().toISOString();
    db.save();
    return res.redirect(`/recipes/${recipe.id}`);
  });

  router.post("/:id/delete", requireUser, (req, res) => {
    const db = req.app.locals.db;
    const recipe = getRecipeOr404(req, res);
    if (!recipe) return;
    if (!canDelete(req.user, recipe)) {
      return res.status(403).send(renderError(403, "Not allowed", "You can only delete your own recipes.", req.user));
    }
    deletePhoto(db, recipe.photo);
    db.state.recipes = db.state.recipes.filter((r) => r.id !== recipe.id);
    db.state.comments = db.state.comments.filter((c) => c.recipeId !== recipe.id);
    db.save();
    return res.redirect("/");
  });

  // Summarize: sends the recipe text (as data) to the provided mock and
  // stores the returned text on the recipe. The response is rendered as
  // plain text by the view layer — never as HTML.
  router.post("/:id/summarize", summarizeLimiter, async (req, res, next) => {
    try {
      const db = req.app.locals.db;
      const recipe = getRecipeOr404(req, res);
      if (!recipe) return;
      const { summary } = await summarizeRecipeText(recipe);
      recipe.lastSummary = summary;
      recipe.lastSummaryAt = new Date().toISOString();
      db.save();
      return res.redirect(`/recipes/${recipe.id}`);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
