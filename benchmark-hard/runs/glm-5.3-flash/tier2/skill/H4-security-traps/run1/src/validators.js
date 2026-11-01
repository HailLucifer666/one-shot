// Boundary validation: reject bad input, never silently "fix" it
// (except e-mail case normalisation, which is documented behaviour).

export function validateEmail(email) {
  const value = String(email ?? "").trim().toLowerCase();
  if (!value) return { ok: false, error: "Email is required." };
  if (value.length > 254) return { ok: false, error: "Email is too long." };
  // Simple, deliberately conservative shape check.
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(value)) return { ok: false, error: "Enter a valid email address." };
  return { ok: true, value };
}

export function validatePassword(password) {
  const value = String(password ?? "");
  if (value.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (value.length > 200) return { ok: false, error: "Password is too long." };
  return { ok: true, value };
}

export function validateRecipeFields(body) {
  const title = String(body.title ?? "");
  const ingredients = String(body.ingredients ?? "");
  const steps = String(body.steps ?? "");
  const errors = [];
  if (!title.trim()) errors.push("Title is required.");
  if (title.length > 200) errors.push("Title must be 200 characters or fewer.");
  if (!ingredients.trim()) errors.push("Ingredients are required.");
  if (ingredients.length > 10000) errors.push("Ingredients must be 10,000 characters or fewer.");
  if (!steps.trim()) errors.push("Steps are required.");
  if (steps.length > 20000) errors.push("Steps must be 20,000 characters or fewer.");
  return { ok: errors.length === 0, errors, values: { title, ingredients, steps } };
}

export function validateComment(body) {
  const text = String(body.body ?? "");
  if (!text.trim()) return { ok: false, error: "Comment cannot be empty." };
  if (text.length > 2000) return { ok: false, error: "Comment must be 2,000 characters or fewer." };
  return { ok: true, value: text };
}

// Only accept a redirect target that is a local path; blocks //host and schemes.
export function safeLocalPath(value, fallback = "/") {
  const v = String(value ?? "");
  if (v.startsWith("/") && !v.startsWith("//") && !v.includes("://") && !v.includes("\\")) {
    return v;
  }
  return fallback;
}
