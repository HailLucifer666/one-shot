// Input validation helpers. A ValidationError carries an HTTP status so the
// central error handler in server.js can turn it into a 400 response.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export function requireString(value, name, { min = 1, max = Infinity } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} is required`);
  }
  const v = value.trim();
  if (v.length < min) {
    throw new ValidationError(`${name} is required`);
  }
  if (v.length > max) {
    throw new ValidationError(`${name} must be at most ${max} characters`);
  }
  return v;
}

export function optionalString(value, name, { max = Infinity } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a string`);
  }
  if (value.trim() === '') return undefined;
  return requireString(value, name, { max });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireEmail(value) {
  const v = requireString(value, 'Email', { max: 254 });
  if (!EMAIL_RE.test(v)) {
    throw new ValidationError('Please enter a valid email address');
  }
  return v.toLowerCase();
}

export function requirePassword(value) {
  return requireString(value, 'Password', { min: 8, max: 200 });
}
