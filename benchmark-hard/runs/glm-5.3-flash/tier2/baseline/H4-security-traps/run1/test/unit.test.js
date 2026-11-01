// Unit tests for the pure helpers: password hashing, image content sniffing,
// cookie parsing, and input validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, parseCookies } from '../src/auth.js';
import { detectImageType, extensionForMime } from '../src/images.js';
import {
  requireString,
  optionalString,
  requireEmail,
  requirePassword,
  ValidationError,
} from '../src/validate.js';

test('passwords are stored as salted scrypt hashes, never plaintext', () => {
  const stored = hashPassword('hunter2-secret');
  assert.match(stored, /^scrypt:16384:8:1:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.ok(!stored.includes('hunter2-secret'));
  // Every hash is salted, so the same password hashes differently.
  assert.notEqual(hashPassword('hunter2-secret'), stored);
});

test('verifyPassword accepts the right password and rejects the wrong one', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('wrong password', stored), false);
  assert.equal(verifyPassword('', stored), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(verifyPassword('x', ''), false);
});

test('parseCookies handles multiple cookies and missing headers', () => {
  assert.deepEqual(parseCookies('sid=abc; csrf=def'), { sid: 'abc', csrf: 'def' });
  assert.deepEqual(parseCookies('sid=a=b'), { sid: 'a=b' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('detectImageType accepts only real JPEG/PNG content, by magic number', () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), 'image/jpeg');
  assert.equal(
    detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    'image/png'
  );
  // Not fooled by names or mimetypes - only the leading bytes count.
  assert.equal(detectImageType(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(detectImageType(Buffer.from('<?xml version="1.0"?><svg onload="alert(1)"/>')), null);
  assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(detectImageType(Buffer.from([0x89, 0x50])), null); // truncated PNG
  assert.equal(detectImageType(Buffer.alloc(0)), null);
  assert.equal(detectImageType('not a buffer'), null);
});

test('extensionForMime maps verified types only', () => {
  assert.equal(extensionForMime('image/png'), '.png');
  assert.equal(extensionForMime('image/jpeg'), '.jpg');
  assert.throws(() => extensionForMime('text/html'));
});

test('validators enforce shape and length', () => {
  assert.equal(requireString('  pancetta  ', 'Title'), 'pancetta');
  assert.throws(() => requireString('', 'Title'), ValidationError);
  assert.throws(() => requireString(undefined, 'Title'), ValidationError);
  assert.throws(() => requireString({ a: 1 }, 'Title'), ValidationError);
  assert.throws(() => requireString('x'.repeat(11), 'Title', { max: 10 }), ValidationError);
  assert.equal(optionalString('', 'X'), undefined);
  assert.equal(optionalString(undefined, 'X'), undefined);
  assert.throws(() => optionalString(42, 'X'), ValidationError);
  assert.equal(requireEmail('  Cook@Example.COM '), 'cook@example.com');
  assert.throws(() => requireEmail('not-an-email'), ValidationError);
  assert.throws(() => requireEmail('a@b'), ValidationError);
  assert.equal(requirePassword('12345678'), '12345678');
  assert.throws(() => requirePassword('short'), ValidationError);
});
