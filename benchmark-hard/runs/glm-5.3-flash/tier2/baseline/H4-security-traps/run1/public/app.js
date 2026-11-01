// RecipeBox frontend.
//
// Rendering rule that holds for every view: any text that came from a user,
// a database field, or the AI summarizer goes through createTextNode (the h()
// helper below). Nothing is ever built with innerHTML, so recipe text,
// comments, and even a hostile summarizer response are displayed literally
// instead of being parsed as HTML. The server's Content-Security-Policy
// (script-src 'self') is the second layer behind this.

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

// ------------------------------------------------------------ API client

function getCookie(name) {
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  // Every state-changing request echoes the csrf cookie in a header; the
  // server compares the two (double-submit pattern).
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = getCookie('csrf') || '';
  }
  let payload;
  if (form) {
    payload = form; // FormData sets its own multipart boundary header
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ----------------------------------------------------------------- state

const state = { user: null, loaded: false };

const headerEl = document.getElementById('site-header');
const viewEl = document.getElementById('view');

function route() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

function routeQuery() {
  const raw = location.hash.split('?')[1] || '';
  return new URLSearchParams(raw);
}

function go(path) {
  location.hash = path;
}

// ---------------------------------------------------------------- header

function renderHeader() {
  const searchForm = h(
    'form',
    { class: 'search-form', onsubmit: onSearchSubmit },
    h('input', {
      type: 'text',
      name: 'q',
      placeholder: 'Search by title or ingredient…',
      'aria-label': 'Search recipes',
    }),
    h('button', { type: 'submit' }, 'Search')
  );

  const userArea = h(
    'div',
    { class: 'user-area' },
    state.user
      ? [
          h('a', { href: '#/new' }, 'New recipe'),
          h('span', {}, `Signed in as ${state.user.displayName}`),
          state.user.role === 'admin' ? h('span', { class: 'hint' }, '(admin)') : null,
          h(
            'button',
            { class: 'secondary', onclick: signOut },
            'Sign out'
          ),
        ]
      : [
          h('a', { href: '#/login' }, 'Sign in'),
          h('a', { href: '#/register' }, 'Register'),
        ]
  );

  headerEl.replaceChildren(
    h(
      'div',
      { class: 'container header-row' },
      h('a', { class: 'brand', href: '#/' }, 'RecipeBox'),
      searchForm,
      userArea
    )
  );
}

function onSearchSubmit(event) {
  event.preventDefault();
  const q = new FormData(event.target).get('q') || '';
  go(`/?q=${encodeURIComponent(String(q))}`);
}

async function signOut() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    // Signing out on a stale session is fine.
  }
  state.user = null;
  renderHeader();
  go('/');
  render();
}

// ------------------------------------------------------------------ views

function errorBanner() {
  const banner = h('div', { class: 'error-banner hidden' });
  return {
    node: banner,
    show(message) {
      banner.textContent = message;
      banner.classList.remove('hidden');
    },
  };
}

async function listView() {
  const q = (routeQuery().get('q') || '').trim();
  const { recipes } = await api(
    q ? `/api/recipes?q=${encodeURIComponent(q)}` : '/api/recipes'
  );

  const heading = q
    ? h('h1', {}, `Search results for "${q}"`)
    : h('h1', {}, 'Latest recipes');

  if (recipes.length === 0) {
    return h(
      'div',
      {},
      heading,
      h('p', { class: 'empty-note' }, 'No recipes found. Be the first to share one!')
    );
  }

  const cards = recipes.map((r) =>
    h(
      'a',
      { class: 'card', href: `#/recipe/${encodeURIComponent(r.id)}` },
      r.photoUrl
        ? h('img', { src: r.photoUrl, alt: `Photo of ${r.title}`, loading: 'lazy' })
        : null,
      h(
        'div',
        { class: 'card-body' },
        h('h3', {}, r.title),
        h('p', {}, r.ingredientsPreview || 'No ingredients listed'),
        h(
          'div',
          { class: 'card-meta' },
          `by ${r.ownerName} - ${r.commentCount} comment${r.commentCount === 1 ? '' : 's'}`
        )
      )
    )
  );

  return h('div', {}, heading, h('div', { class: 'card-grid' }, cards));
}

async function detailView(id) {
  let data;
  try {
    data = await api(`/api/recipes/${encodeURIComponent(id)}`);
  } catch (err) {
    return h(
      'div',
      {},
      h('p', { class: 'empty-note' }, err.message),
      h('a', { class: 'btn', href: '#/' }, 'Back to all recipes')
    );
  }
  const { recipe, comments } = data;

  const summaryBox = h('div', { class: 'summary-box hidden' });
  const summarizeBtn = h(
    'button',
    {
      onclick: async () => {
        summarizeBtn.disabled = true;
        summaryBox.textContent = 'Summarizing…';
        summaryBox.classList.remove('hidden');
        try {
          const { summary } = await api(
            `/api/recipes/${encodeURIComponent(recipe.id)}/summary`,
            { method: 'POST' }
          );
          summaryBox.textContent = summary;
        } catch (err) {
          summaryBox.textContent = err.message;
        } finally {
          summarizeBtn.disabled = false;
        }
      },
    },
    'Summarize'
  );

  const actions = h(
    'div',
    { class: 'detail-actions' },
    summarizeBtn,
    recipe.canEdit
      ? h(
          'a',
          { class: 'btn secondary', href: `#/edit/${encodeURIComponent(recipe.id)}` },
          'Edit'
        )
      : null,
    recipe.canDelete
      ? h(
          'button',
          {
            class: 'danger',
            onclick: async () => {
              if (!confirm('Delete this recipe? This cannot be undone.')) return;
              try {
                await api(`/api/recipes/${encodeURIComponent(recipe.id)}`, {
                  method: 'DELETE',
                });
                go('/');
                render();
              } catch (err) {
                alert(err.message);
              }
            },
          },
          'Delete'
        )
      : null
  );

  const commentList = h(
    'div',
    {},
    comments.length === 0
      ? h('p', { class: 'hint' }, 'No comments yet.')
      : comments.map((c) =>
          h(
            'div',
            { class: 'comment' },
            h(
              'div',
              { class: 'comment-head' },
              h('span', { class: 'who' }, c.authorName),
              c.canDelete
                ? h(
                    'button',
                    {
                      onclick: async () => {
                        if (!confirm('Delete this comment?')) return;
                        try {
                          await api(`/api/comments/${encodeURIComponent(c.id)}`, {
                            method: 'DELETE',
                          });
                          render();
                        } catch (err) {
                          alert(err.message);
                        }
                      },
                    },
                    'Delete'
                  )
                : null
            ),
            h('p', { class: 'comment-body' }, c.body)
          )
        )
  );

  const commentForm = state.user
    ? (() => {
        const banner = errorBanner();
        const textarea = h('textarea', {
          name: 'body',
          placeholder: 'Share a tip, a substitution, or how it turned out…',
          maxlength: '2000',
          required: true,
        });
        return h(
          'form',
          {
            class: 'section',
            onsubmit: async (event) => {
              event.preventDefault();
              banner.node.classList.add('hidden');
              try {
                await api(`/api/recipes/${encodeURIComponent(recipe.id)}/comments`, {
                  method: 'POST',
                  body: { body: new FormData(event.target).get('body') },
                });
                render();
              } catch (err) {
                banner.show(err.message);
              }
            },
          },
          h('h2', {}, 'Add a comment'),
          banner.node,
          textarea,
          h('div', { style: 'margin-top:10px' }, h('button', { type: 'submit' }, 'Post comment'))
        );
      })()
    : h(
        'p',
        { class: 'hint section' },
        'Sign in to join the conversation.',
        h('span', {}, ' '),
        h('a', { href: '#/login' }, 'Sign in')
      );

  return h(
    'article',
    {},
    h(
      'div',
      { class: 'detail-header' },
      h('h1', {}, recipe.title),
      h('div', {}, actions)
    ),
    h('p', { class: 'meta-line' }, `by ${recipe.ownerName} - posted ${fmtDate(recipe.createdAt)}`),
    recipe.photoUrl
      ? h('img', { class: 'detail-photo', src: recipe.photoUrl, alt: `Photo of ${recipe.title}` })
      : null,
    h('div', { class: 'section' }, h('h2', {}, 'Ingredients'), h('pre', {}, recipe.ingredients)),
    h('div', { class: 'section' }, h('h2', {}, 'Steps'), h('pre', {}, recipe.steps)),
    h('div', { class: 'section' }, h('h2', {}, 'AI summary'), summarizeBtn, summaryBox),
    h('div', { class: 'section' }, h('h2', {}, 'Comments'), commentList),
    commentForm
  );
}

function recipeFormView(editId) {
  const banner = errorBanner();
  const fields = { title: h('input', { type: 'text', name: 'title', maxlength: '200', required: true }), ingredients: h('textarea', { name: 'ingredients', required: true }), steps: h('textarea', { name: 'steps', required: true }) };
  const photoInput = h('input', { type: 'file', name: 'photo', accept: 'image/jpeg,image/png' });
  const existingPhoto = h('div');

  const form = h(
    'form',
    {
      class: 'panel',
      onsubmit: async (event) => {
        event.preventDefault();
        banner.show('Saving…');
        const fd = new FormData();
        fd.set('title', fields.title.value);
        fd.set('ingredients', fields.ingredients.value);
        fd.set('steps', fields.steps.value);
        const file = photoInput.files && photoInput.files[0];
        if (file) fd.set('photo', file);
        try {
          if (editId) {
            await api(`/api/recipes/${encodeURIComponent(editId)}`, { method: 'PUT', form: fd });
            go(`/recipe/${encodeURIComponent(editId)}`);
          } else {
            const { recipe } = await api('/api/recipes', { method: 'POST', form: fd });
            go(`/recipe/${encodeURIComponent(recipe.id)}`);
          }
          render();
        } catch (err) {
          banner.show(err.message);
        }
      },
    },
    h('h1', { class: 'form-title' }, editId ? 'Edit recipe' : 'New recipe'),
    banner.node,
    h('label', { class: 'field' }, h('span', {}, 'Title'), fields.title),
    h('label', { class: 'field' }, h('span', {}, 'Ingredients (one per line)'), fields.ingredients),
    h('label', { class: 'field' }, h('span', {}, 'Steps'), fields.steps),
    h('label', { class: 'field' }, h('span', {}, 'Photo (JPG or PNG, up to 2 MB)'), photoInput),
    existingPhoto,
    h('div', { class: 'actions-row' }, h('button', { type: 'submit' }, editId ? 'Save changes' : 'Post recipe'), h('a', { class: 'btn secondary', href: '#/' }, 'Cancel'))
  );

  if (editId) {
    api(`/api/recipes/${encodeURIComponent(editId)}`)
      .then(({ recipe }) => {
        if (!recipe.canEdit) {
          viewEl.replaceChildren(
            h('p', { class: 'empty-note' }, 'Only the owner can edit this recipe.'),
            h('a', { class: 'btn', href: `#/recipe/${encodeURIComponent(editId)}` }, 'Back')
          );
          return;
        }
        fields.title.value = recipe.title;
        fields.ingredients.value = recipe.ingredients;
        fields.steps.value = recipe.steps;
        if (recipe.photoUrl) {
          existingPhoto.replaceChildren(
            h('img', { class: 'detail-photo', src: recipe.photoUrl, alt: `Current photo of ${recipe.title}`, style: 'max-height:160px' }),
            h('p', { class: 'hint' }, 'Current photo. Choose a new file above to replace it.')
          );
        }
      })
      .catch((err) => banner.show(err.message));
  }

  return form;
}

function loginView() {
  const banner = errorBanner();
  return h(
    'form',
    {
      class: 'panel',
      onsubmit: async (event) => {
        event.preventDefault();
        const fd = new FormData(event.target);
        try {
          const { user } = await api('/api/auth/login', {
            method: 'POST',
            body: { email: fd.get('email'), password: fd.get('password') },
          });
          state.user = user;
          renderHeader();
          go('/');
          render();
        } catch (err) {
          banner.show(err.message);
        }
      },
    },
    h('h1', { class: 'form-title' }, 'Sign in'),
    banner.node,
    h('label', { class: 'field' }, h('span', {}, 'Email'), h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
    h('label', { class: 'field' }, h('span', {}, 'Password'), h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
    h('div', { class: 'actions-row' }, h('button', { type: 'submit' }, 'Sign in'), h('span', { class: 'hint' }, 'New here? '), h('a', { href: '#/register' }, 'Create an account'))
  );
}

function registerView() {
  const banner = errorBanner();
  return h(
    'form',
    {
      class: 'panel',
      onsubmit: async (event) => {
        event.preventDefault();
        const fd = new FormData(event.target);
        try {
          const { user } = await api('/api/auth/register', {
            method: 'POST',
            body: {
              email: fd.get('email'),
              password: fd.get('password'),
              displayName: fd.get('displayName') || undefined,
            },
          });
          state.user = user;
          renderHeader();
          go('/');
          render();
        } catch (err) {
          banner.show(err.message);
        }
      },
    },
    h('h1', { class: 'form-title' }, 'Create an account'),
    banner.node,
    h('label', { class: 'field' }, h('span', {}, 'Email'), h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
    h('label', { class: 'field' }, h('span', {}, 'Display name (optional)'), h('input', { type: 'text', name: 'displayName', maxlength: '60' })),
    h('label', { class: 'field' }, h('span', {}, 'Password (at least 8 characters)'), h('input', { type: 'password', name: 'password', minlength: '8', required: true, autocomplete: 'new-password' })),
    h('div', { class: 'actions-row' }, h('button', { type: 'submit' }, 'Register'), h('span', { class: 'hint' }, 'Already have an account? '), h('a', { href: '#/login' }, 'Sign in'))
  );
}

// ----------------------------------------------------------------- router

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

async function render() {
  renderHeader();
  const path = route();
  try {
    let node;
    let match;
    if (path === '/') {
      node = await listView();
    } else if (path === '/new') {
      node = state.user ? recipeFormView(null) : needAuth();
    } else if ((match = path.match(/^\/recipe\/([^/]+)$/))) {
      node = await detailView(decodeURIComponent(match[1]));
    } else if ((match = path.match(/^\/edit\/([^/]+)$/))) {
      node = state.user ? recipeFormView(decodeURIComponent(match[1])) : needAuth();
    } else if (path === '/login') {
      node = state.user ? redirectHome() : loginView();
    } else if (path === '/register') {
      node = state.user ? redirectHome() : registerView();
    } else {
      node = h('p', { class: 'empty-note' }, 'Page not found.');
    }
    viewEl.replaceChildren(node);
  } catch (err) {
    viewEl.replaceChildren(
      h('p', { class: 'empty-note' }, err.message || 'Something went wrong.')
    );
  }
}

function needAuth() {
  return h(
    'div',
    {},
    h('p', { class: 'empty-note' }, 'Please sign in first.'),
    h('a', { class: 'btn', href: '#/login' }, 'Sign in')
  );
}

function redirectHome() {
  go('/');
  return h('div');
}

window.addEventListener('hashchange', render);

(async function init() {
  try {
    const { user } = await api('/api/auth/me');
    state.user = user;
  } catch {
    state.user = null;
  }
  state.loaded = true;
  render();
})();
