// /api comment routes.
//   - create: any signed-in user, on an existing recipe
//   - delete: the comment's author, or an admin

import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth, csrfProtect } from '../auth.js';
import { requireString } from '../validate.js';

export function commentRoutes(db) {
  const router = Router();

  function commentView(comment, user) {
    const author = db.data.users.find((u) => u.id === comment.authorId);
    return {
      id: comment.id,
      recipeId: comment.recipeId,
      body: comment.body,
      authorId: comment.authorId,
      authorName: author?.displayName ?? 'Unknown cook',
      createdAt: comment.createdAt,
      canDelete:
        !!user && (user.id === comment.authorId || user.role === 'admin'),
    };
  }

  router.post(
    '/recipes/:id/comments',
    requireAuth,
    csrfProtect,
    (req, res) => {
      const recipe = db.data.recipes.find((r) => r.id === req.params.id);
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      const body = requireString(req.body?.body, 'Comment', { max: 2000 });
      const comment = {
        id: crypto.randomUUID(),
        recipeId: recipe.id,
        authorId: req.user.id,
        body,
        createdAt: new Date().toISOString(),
      };
      db.data.comments.push(comment);
      db.save();
      res.status(201).json({ comment: commentView(comment, req.user) });
    }
  );

  router.delete('/comments/:id', requireAuth, csrfProtect, (req, res) => {
    const comment = db.data.comments.find((c) => c.id === req.params.id);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (comment.authorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Only the comment author or an admin can delete this comment',
      });
    }
    db.data.comments = db.data.comments.filter((c) => c.id !== comment.id);
    db.save();
    res.status(204).end();
  });

  return router;
}
