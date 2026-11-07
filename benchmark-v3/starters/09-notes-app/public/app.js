"use strict";

const listEl = document.getElementById("list");
const form = document.getElementById("note-form");
const searchEl = document.getElementById("search");
const titleEl = document.getElementById("title");
const bodyEl = document.getElementById("body");

async function refresh() {
  const q = searchEl.value.trim();
  try {
    if (q) {
      const res = await fetch(`/api/notes/search?q=${encodeURIComponent(q)}`);
      const notes = await res.json();
      renderNotes(notes, `Search results for "${q}"`);
    } else {
      const res = await fetch("/api/notes");
      const groups = await res.json();
      renderGroups(groups);
    }
  } catch {
    listEl.innerHTML = '<p class="empty">Could not reach the server.</p>';
  }
}

function renderGroups(groups) {
  if (groups.length === 0) {
    listEl.innerHTML = '<p class="empty">No notes yet. Add your first one above.</p>';
    return;
  }
  listEl.innerHTML = groups
    .map(
      (group) => `
      <section class="day">
        <h2>${escapeHtml(group.date)}</h2>
        ${group.notes.map(noteCard).join("")}
      </section>`
    )
    .join("");
}

function renderNotes(notes, heading) {
  if (notes.length === 0) {
    listEl.innerHTML = '<p class="empty">Nothing matched.</p>';
    return;
  }
  listEl.innerHTML = `
    <section class="day">
      <h2>${escapeHtml(heading)}</h2>
      ${notes.map(noteCard).join("")}
    </section>`;
}

function noteCard(note) {
  return `
    <article class="note">
      <div class="note-head">
        <strong>${escapeHtml(note.title)}</strong>
        <button class="delete" data-id="${note.id}" aria-label="Delete note ${note.id}">Delete</button>
      </div>
      <p>${escapeHtml(note.body)}</p>
      <time>${escapeHtml(note.createdAt)}</time>
    </article>`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const res = await fetch("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: titleEl.value, body: bodyEl.value }),
  });
  if (res.ok) {
    form.reset();
    titleEl.focus();
    await refresh();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Could not save the note.");
  }
});

listEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button.delete");
  if (!button) return;
  await fetch(`/api/notes/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
  await refresh();
});

searchEl.addEventListener("input", refresh);

refresh();
