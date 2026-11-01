// /api/recipes routes: list + search, detail, create, edit, delete, summarize.
//
// Permission model (enforced here, server-side, on every request):
//   - list/detail/search: public
//   - create: any signed-in user
//   - edit: only the recipe's owner
//   - delete: the owner, or an admin
// Client-supplied ids and roles are never trusted for these decisions.

import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth, csrfProtect } from '../auth.js';
import { ValidationError, requireString, optionalString } from '../validate.js';
import { detectImageType, extensionForMime, MAX_PHOTO_BYTES } from '../images.js';
import { complete } from '../llm.js';

const SUMMARY_USER_TEXT_LIMIT = 4000;

export function recipeRoutes(db, uploadsDir) {
  const router = Router();

  // Photos are parsed into memory (they are capped at 2 MB) so the content
  // can be verified before anything is written under uploads/.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  });

  const displayName = (userId) =>
    db.data.users.find((u) => u.id === userId)?.displayName ?? 'Unknown cook';

  const photoUrl = (recipe) =>
    recipe.photoFilename ? `/uploads/${recipe.photoFilename}` : null;

  function canDelete(recipe, user) {
    return !!user && (user.id === recipe.ownerId || user.role === 'admin');
  }

  function listView(recipe) {
    return {
      id: recipe.id,
      title: recipe.title,
      ingredientsPreview: recipe.ingredients.slice(0, 160),
      photoUrl: photoUrl(recipe),
      ownerName: displayName(recipe.ownerId),
      createdAt: recipe.createdAt,
      commentCount: db.data.comments.filter((c) => c.recipeId === recipe.id).length,
    };
  }

  function detailView(recipe, user) {
    return {
      id: recipe.id,
      title: recipe.title,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      photoUrl: photoUrl(recipe),
      ownerId: recipe.ownerId,
      ownerName: displayName(recipe.ownerId),
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      canEdit: !!user && user.id === recipe.ownerId,
      canDelete: canDelete(recipe, user),
    };
  }

  function findRecipe(id) {
    return db.data.recipes.find((r) => r.id === id) || null;
  }

  function storePhoto(file) {
    const mime = detectImageType(file.buffer);
    if (!mime) {
      throw new ValidationError('Photo must be a real JPEG or PNG image');
    }
    const filename = crypto.randomUUID() + extensionForMime(mime);
    fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
    return filename;
  }

  function removePhotoFile(filename) {
    if (!filename) return;
    try {
      fs.unlinkSync(path.join(uploadsDir, filename));
    } catch {
      // A missing file must not block the recipe deletion.
    }
  }

  // ------------------------------------------------------------ public read

  router.get('/recipes', (req, res) => {
    let q = req.query.q ?? '';
    if (Array.isArray(q)) q = q[0] ?? '';
    q = String(q).trim().toLowerCase();
    const recipes = db.data.recipes
      .filter(
        (r) =>
          !q ||
          r.title.toLowerCase().includes(q) ||
          r.ingredients.toLowerCase().includes(q)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(listView);
    res.json({ recipes, q });
  });

  router.get('/recipes/:id', (req, res) => {
    const recipe = findRecipe(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    const user = req.user ?? null;
    const comments = db.data.comments
      .filter((c) => c.recipeId === recipe.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({
        id: c.id,
        body: c.body,
        authorId: c.authorId,
        authorName: displayName(c.authorId),
        createdAt: c.createdAt,
        canDelete:
          !!user && (user.id === c.authorId || user.role === 'admin'),
      }));
    res.json({ recipe: detailView(recipe, user), comments });
  });

  // ----------------------------------------------------------------- create

  router.post(
    '/recipes',
    requireAuth,
    csrfProtect,
    upload.single('photo'),
    (req, res) => {
      const title = requireString(req.body?.title, 'Title', { max: 200 });
      const ingredients = requireString(req.body?.ingredients, 'Ingredients', {
        max: 10000,
      });
      const steps = requireString(req.body?.steps, 'Steps', { max: 10000 });

      let photoFilename = null;
      if (req.file) {
        if (req.file.size > MAX_PHOTO_BYTES) {
          throw new ValidationError('Photo must be 2 MB or smaller');
        }
        photoFilename = storePhoto(req.file);
      }

      const now = new Date().toISOString();
      const recipe = {
        id: crypto.randomUUID(),
        ownerId: req.user.id,
        title,
        ingredients,
        steps,
        photoFilename,
        createdAt: now,
        updatedAt: now,
      };
      db.data.recipes.push(recipe);
      db.save();
      res.status(201).json({ recipe: detailView(recipe, req.user) });
    }
  );

  // ------------------------------------------------------------------- edit

  router.put(
    '/recipes/:id',
    requireAuth,
    csrfProtect,
    upload.single('photo'),
    (req, res) => {
      const recipe = findRecipe(req.params.id);
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      if (recipe.ownerId !== req.user.id) {
        return res
          .status(403)
          .json({ error: 'Only the owner can edit this recipe' });
      }
      recipe.title =
        optionalString(req.body?.title, 'Title', { max: 200 }) ?? recipe.title;
      recipe.ingredients =
        optionalString(req.body?.ingredients, 'Ingredients', { max: 10000 }) ??
        recipe.ingredients;
      recipe.steps =
        optionalString(req.body?.steps, 'Steps', { max: 10000 }) ?? recipe.steps;

      if (req.file) {
        if (req.file.size > MAX_PHOTO_BYTES) {
          throw new ValidationError('Photo must be 2 MB or smaller');
        }
        const oldFile = recipe.photoFilename;
        recipe.photoFilename = storePhoto(req.file);
        removePhotoFile(oldFile);
      }

      recipe.updatedAt = new Date().toISOString();
      db.save();
      res.json({ recipe: detailView(recipe, req.user) });
    }
  );

  // ----------------------------------------------------------------- delete

  router.delete('/recipes/:id', requireAuth, csrfProtect, (req, res) => {
    const recipe = findRecipe(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    if (recipe.ownerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Only the owner or an admin can delete this recipe',
      });
    }
    db.data.recipes = db.data.recipes.filter((r) => r.id !== recipe.id);
    db.data.comments = db.data.comments.filter((c) => c.recipeId !== recipe.id);
    removePhotoFile(recipe.photoFilename);
    db.save();
    res.status(204).end();
  });

  // -------------------------------------------------------------- summarize

  router.post(
    '/recipes/:id/summary',
    requireAuth,
    csrfProtect,
    async (req, res) => {
      const recipe = findRecipe(req.params.id);
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      const text = [
        `Title: ${recipe.title}`,
        '',
        'Ingredients:',
        recipe.ingredients,
        '',
        'Steps:',
        recipe.steps,
      ]
        .join('\n')
        .slice(0, SUMMARY_USER_TEXT_LIMIT);

      // The only AI call in the app - the provided mock. Whatever it returns
      // is delivered as JSON data; the browser renders it as plain text.
      const summary = await complete({
        system:
          'You summarize recipes into a few clear sentences for home cooks. Summaries are plain text, never HTML.',
        user: text,
      });
      res.json({ summary });
    }
  );

  return router;
}
