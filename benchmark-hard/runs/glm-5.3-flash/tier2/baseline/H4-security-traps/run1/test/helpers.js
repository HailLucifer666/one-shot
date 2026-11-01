// Shared helpers for the test suite: boots the app on an ephemeral port with
// isolated data/uploads directories, plus a small cookie-jar HTTP client.

import { createApp } from '../server.js';

export async function startServer(config) {
  const app = createApp(config);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = {};
  }

  storeCookies(res) {
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '') delete this.cookies[name];
      else this.cookies[name] = value;
    }
  }

  cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async req(method, path, { json, form, headers = {} } = {}) {
    const h = { ...headers };
    if (Object.keys(this.cookies).length) {
      h.cookie = this.cookieHeader();
    }
    let body;
    if (form) {
      body = form; // undici sets the multipart boundary header itself
    } else if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' });
    this.storeCookies(res);
    return res;
  }

  // State-changing request with the CSRF header filled from the cookie jar.
  async authed(method, path, opts = {}) {
    return this.req(method, path, {
      ...opts,
      headers: { 'x-csrf-token': this.cookies.csrf || '', ...opts.headers },
    });
  }

  async prime() {
    // Any API GET issues the csrf cookie needed for later POSTs.
    await this.req('GET', '/api/auth/me');
  }

  async register(email, password, extra = {}) {
    await this.prime();
    return this.authed('POST', '/api/auth/register', {
      json: { email, password, ...extra },
    });
  }

  async login(email, password) {
    await this.prime();
    return this.authed('POST', '/api/auth/login', { json: { email, password } });
  }

  async form(method, path, { fields = {}, file } = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (file) fd.set('photo', new Blob([file.buffer], { type: file.type }), file.name);
    return this.authed(method, path, { form: fd });
  }
}

export function pngBytes(size = 64) {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([magic, Buffer.alloc(Math.max(size - magic.length, 0), 7)]);
}

export function jpegBytes(size = 64) {
  const magic = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  return Buffer.concat([magic, Buffer.alloc(Math.max(size - magic.length, 0), 3)]);
}
