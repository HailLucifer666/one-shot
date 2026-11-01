// Server-rendered HTML. Every dynamic value passes through escapeHtml();
// no user or AI/LLM output is ever interpolated unescaped.

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function nav(user) {
  if (user) {
    return `
      <a class="btn btn-primary" href="/recipes/new">New recipe</a>
      <span class="nav-user" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</span>
      <form method="post" action="/logout" class="inline-form">
        <button class="btn btn-secondary" type="submit">Log out</button>
      </form>`;
  }
  return `
    <a class="nav-link" href="/login">Log in</a>
    <a class="btn btn-primary" href="/register">Register</a>`;
}

export function layout({ title, user, content, searchValue = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · RecipeBox</title>
  <meta name="description" content="RecipeBox — a community recipe board. Share recipes, comment, and get a quick summary.">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-row">
      <a class="brand" href="/">Recipe<span>Box</span></a>
      <form class="search-form" action="/" method="get" role="search">
        <label class="visually-hidden" for="q">Search recipes by title or ingredient</label>
        <input id="q" name="q" type="search" autocomplete="off" placeholder="Search by title or ingredient" value="${escapeHtml(searchValue)}">
        <button class="btn btn-secondary" type="submit">Search</button>
      </form>
      <nav class="site-nav" aria-label="Account">${nav(user)}</nav>
    </div>
  </header>
  <main id="main" class="wrap">
    ${content}
  </main>
  <footer class="site-footer">
    <div class="wrap">RecipeBox — a community recipe board.</div>
  </footer>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function recipeCard(recipe, ownerEmail) {
  const photo = recipe.photo
    ? `<img src="/photos/${escapeHtml(recipe.photo.storedName)}" alt="Photo of ${escapeHtml(recipe.title)}" loading="lazy" width="640" height="480">`
    : `<span class="card-initial" aria-hidden="true">${escapeHtml(recipe.title.trim().charAt(0).toUpperCase() || "?" )}</span>`;
  const firstLine = recipe.ingredients.split(/\r?\n/).find((l) => l.trim()) || "";
  return `
    <article class="card">
      <a class="card-photo" href="/recipes/${escapeHtml(recipe.id)}" tabindex="-1" aria-hidden="true">${photo}</a>
      <div class="card-body">
        <h3 class="card-title"><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a></h3>
        <p class="card-meta">by ${escapeHtml(ownerEmail)} · ${escapeHtml(formatDate(recipe.createdAt))}</p>
        <p class="card-snippet">${escapeHtml(firstLine)}</p>
      </div>
    </article>`;
}

export function renderHome({ user, recipes, ownerEmails, q = "" }) {
  const heading = q
    ? `<h1>Search results for &ldquo;${escapeHtml(q)}&rdquo;</h1><p class="page-sub">${recipes.length} recipe${recipes.length === 1 ? "" : "s"} found. <a href="/">Clear search</a></p>`
    : `<h1>Fresh from the community kitchen</h1><p class="page-sub">Browse recipes, or share one of your own.</p>`;

  const list = recipes.length
    ? `<div class="card-grid">${recipes.map((r) => recipeCard(r, ownerEmails.get(r.ownerId) || "unknown")).join("")}</div>`
    : q
      ? `<div class="empty-state"><h2>No recipes match that search</h2><p>Try a different title or ingredient, or <a href="/">browse everything</a>.</p></div>`
      : `<div class="empty-state"><h2>No recipes yet</h2><p>Be the first to share what you cook. ${user ? `<a href="/recipes/new">Post a recipe</a>` : `<a href="/register">Register</a> to post the first one.`}</p></div>`;

  return layout({ title: q ? `Search: ${q}` : "Home", user, searchValue: q, content: `${heading}${list}` });
}

export function renderRegister({ user = null, errors = [], values = {} } = {}) {
  const content = `
    <div class="auth-card">
      <h1>Create your account</h1>
      ${errors.length ? `<div class="error-box" role="alert">${errors.map((e) => `<p>${escapeHtml(e)}</p>`).join("")}</div>` : ""}
      <form method="post" action="/register" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" required value="${escapeHtml(values.email || "")}">
        </div>
        <div class="field">
          <label for="password">Password <span class="hint">(at least 8 characters)</span></label>
          <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
        </div>
        <button class="btn btn-primary btn-block" type="submit">Register</button>
      </form>
      <p class="auth-alt">Already have an account? <a href="/login">Log in</a></p>
    </div>`;
  return layout({ title: "Register", user, content });
}

export function renderLogin({ user = null, errors = [], values = {}, next = "" } = {}) {
  const content = `
    <div class="auth-card">
      <h1>Welcome back</h1>
      ${errors.length ? `<div class="error-box" role="alert">${errors.map((e) => `<p>${escapeHtml(e)}</p>`).join("")}</div>` : ""}
      <form method="post" action="/login" novalidate>
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" required value="${escapeHtml(values.email || "")}">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Log in</button>
      </form>
      <p class="auth-alt">New here? <a href="/register">Create an account</a></p>
    </div>`;
  return layout({ title: "Log in", user, content });
}

const STATUS_TEXT = {
  400: "Bad request",
  401: "Sign in required",
  403: "Not allowed",
  404: "Page not found",
  413: "Too large",
  429: "Slow down",
  500: "Something went wrong",
};

export function renderError(status, heading, message, user = null) {
  const content = `
    <div class="empty-state error-page">
      <p class="error-code">${status}</p>
      <h1>${escapeHtml(heading || STATUS_TEXT[status] || "Error")}</h1>
      <p>${escapeHtml(message)}</p>
      <p><a class="btn btn-secondary" href="/">Back to recipes</a></p>
    </div>`;
  return layout({ title: STATUS_TEXT[status] || "Error", user, content });
}

export function renderRecipeForm({ user, mode, errors = [], values = {}, recipe = null } = {}) {
  const isEdit = mode === "edit";
  const action = isEdit ? `/recipes/${escapeHtml(recipe.id)}/edit` : "/recipes";
  const currentPhoto = isEdit && recipe.photo
    ? `<div class="field">
        <span class="field-label">Current photo</span>
        <img class="recipe-photo photo-thumb" src="/photos/${escapeHtml(recipe.photo.storedName)}" alt="Current photo for ${escapeHtml(recipe.title)}">
        <label class="check-label"><input type="checkbox" name="removePhoto" value="1"> Remove this photo</label>
      </div>`
    : "";
  const content = `
    <div class="auth-card recipe-form-card">
      <h1>${isEdit ? "Edit recipe" : "Share a recipe"}</h1>
      ${errors.length ? `<div class="error-box" role="alert">${errors.map((e) => `<p>${escapeHtml(e)}</p>`).join("")}</div>` : ""}
      <form method="post" action="${action}" enctype="multipart/form-data" novalidate>
        <div class="field">
          <label for="title">Title</label>
          <input id="title" name="title" type="text" maxlength="200" required value="${escapeHtml(values.title || "")}">
        </div>
        <div class="field">
          <label for="ingredients">Ingredients <span class="hint">(one per line)</span></label>
          <textarea id="ingredients" name="ingredients" rows="6" required>${escapeHtml(values.ingredients || "")}</textarea>
        </div>
        <div class="field">
          <label for="steps">Steps</label>
          <textarea id="steps" name="steps" rows="8" required>${escapeHtml(values.steps || "")}</textarea>
        </div>
        ${currentPhoto}
        <div class="field">
          <label for="photo">Photo <span class="hint">(optional — JPG or PNG, up to 2 MB)</span></label>
          <input id="photo" name="photo" type="file" accept="image/jpeg,image/png">
          <p class="hint" id="photo-note"></p>
          <div id="photo-preview" hidden></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">${isEdit ? "Save changes" : "Post recipe"}</button>
      </form>
    </div>`;
  return layout({ title: isEdit ? "Edit recipe" : "New recipe", user, content });
}

export function renderRecipe({ user, recipe, ownerEmail, comments = [], summary = null } = {}) {
  const isOwner = Boolean(user && user.id === recipe.ownerId);
  const isAdmin = Boolean(user && user.role === "admin");
  const canDelete = isOwner || isAdmin;

  const actions = [];
  if (isOwner) actions.push(`<a class="btn btn-secondary" href="/recipes/${escapeHtml(recipe.id)}/edit">Edit</a>`);
  if (canDelete) {
    actions.push(`
      <form method="post" action="/recipes/${escapeHtml(recipe.id)}/delete" class="inline-form">
        <button class="btn btn-danger" type="submit" data-confirm="Delete this recipe? This cannot be undone.">Delete</button>
      </form>`);
  }
  actions.push(`
    <form method="post" action="/recipes/${escapeHtml(recipe.id)}/summarize" class="inline-form">
      <button class="btn btn-primary" type="submit">Summarize</button>
    </form>`);

  const photoHtml = recipe.photo
    ? `<img class="recipe-photo" src="/photos/${escapeHtml(recipe.photo.storedName)}" alt="Photo of ${escapeHtml(recipe.title)}" width="960" height="720">`
    : "";

  const summaryHtml = summary
    ? `<section class="recipe-section" aria-label="AI summary">
        <h2>AI summary</h2>
        <div class="summary-box"><p>${escapeHtml(summary)}</p></div>
        <p class="hint">Generated from the recipe text. Treat it as a rough sketch, not a source of truth.</p>
      </section>`
    : "";

  const commentList = comments.length
    ? comments
        .map(
          (c) => `
      <div class="comment">
        <div class="comment-row">
          <p class="comment-meta">${escapeHtml(c.authorEmail)} · ${escapeHtml(formatDate(c.createdAt))}</p>
          ${isAdmin ? `
          <form method="post" action="/comments/${escapeHtml(c.id)}/delete" class="inline-form">
            <button class="btn btn-danger btn-small" type="submit" data-confirm="Delete this comment?">Delete</button>
          </form>` : ""}
        </div>
        <p class="comment-body">${escapeHtml(c.body)}</p>
      </div>`
        )
        .join("")
    : `<p class="card-snippet">No comments yet.</p>`;

  const commentForm = user
    ? `
      <form method="post" action="/recipes/${escapeHtml(recipe.id)}/comments" novalidate>
        <div class="field">
          <label for="comment-body">Add a comment</label>
          <textarea id="comment-body" name="body" rows="3" maxlength="2000" required></textarea>
        </div>
        <button class="btn btn-primary" type="submit">Post comment</button>
      </form>`
    : `<p class="notice"><a href="/login?next=${encodeURIComponent(`/recipes/${recipe.id}`)}">Log in</a> to join the conversation.</p>`;

  const content = `
    <article class="recipe-page">
      <div class="recipe-head">
        <h1>${escapeHtml(recipe.title)}</h1>
        <p class="recipe-byline">by ${escapeHtml(ownerEmail)} · ${escapeHtml(formatDate(recipe.createdAt))}${recipe.updatedAt !== recipe.createdAt ? ` · edited ${escapeHtml(formatDate(recipe.updatedAt))}` : ""}</p>
        <div class="recipe-actions">${actions.join("")}</div>
      </div>
      ${photoHtml}
      <section class="recipe-section"><h2>Ingredients</h2><p class="recipe-text">${escapeHtml(recipe.ingredients)}</p></section>
      <section class="recipe-section"><h2>Steps</h2><p class="recipe-text">${escapeHtml(recipe.steps)}</p></section>
      ${summaryHtml}
      <section class="recipe-section" aria-label="Comments">
        <h2>Comments (${comments.length})</h2>
        ${commentList}
        ${commentForm}
      </section>
    </article>`;
  return layout({ title: recipe.title, user, content });
}
