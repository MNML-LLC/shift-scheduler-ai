import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSessionToken, verifySessionToken } from './middleware.js';

const SECRET = 'test-secret-at-least-32-bytes-long-xxxx';

describe('createSessionToken / verifySessionToken', () => {
  let consoleWarnSpy;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BASIC_AUTH_SECRET;
  });

  it('creates a token that verifies successfully', async () => {
    const token = await createSessionToken('alice', SECRET);
    expect(token).toContain('.');

    const isValid = await verifySessionToken(token, SECRET);
    expect(isValid).toBe(true);
  });

  it('rejects a token with a tampered signature', async () => {
    const token = await createSessionToken('alice', SECRET);
    const [payloadB64, signatureB64] = token.split('.');
    const tamperedSignature = signatureB64.slice(0, -1) + (signatureB64.at(-1) === 'A' ? 'B' : 'A');
    const tamperedToken = `${payloadB64}.${tamperedSignature}`;

    const isValid = await verifySessionToken(tamperedToken, SECRET);
    expect(isValid).toBe(false);
  });

  it('rejects a token with a tampered payload', async () => {
    const token = await createSessionToken('alice', SECRET);
    const [, signatureB64] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ username: 'admin', expiresAt: Date.now() + 1000000 }),
      'utf-8'
    ).toString('base64');
    const forgedToken = `${forgedPayload}.${signatureB64}`;

    const isValid = await verifySessionToken(forgedToken, SECRET);
    expect(isValid).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken('alice', SECRET);
    const isValid = await verifySessionToken(token, 'a-completely-different-secret-value');
    expect(isValid).toBe(false);
  });

  it('rejects an unsigned legacy token (plain base64 JSON, no signature)', async () => {
    const legacyToken = Buffer.from(
      JSON.stringify({ username: 'alice', expiresAt: Date.now() + 1000000 }),
      'utf-8'
    ).toString('base64');

    const isValid = await verifySessionToken(legacyToken, SECRET);
    expect(isValid).toBe(false);
  });

  it('rejects an expired token even with a valid signature', async () => {
    const payload = { username: 'alice', expiresAt: Date.now() - 1000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const signatureB64 = Buffer.from(signatureBuffer).toString('base64');
    const expiredToken = `${payloadB64}.${signatureB64}`;

    const isValid = await verifySessionToken(expiredToken, SECRET);
    expect(isValid).toBe(false);
  });

  it('rejects garbage/malformed tokens', async () => {
    expect(await verifySessionToken('not-a-valid-token', SECRET)).toBe(false);
    expect(await verifySessionToken('', SECRET)).toBe(false);
    expect(await verifySessionToken('a.b.c', SECRET)).toBe(false);
  });

  it('throws when creating a token without a configured secret', async () => {
    await expect(createSessionToken('alice', null)).rejects.toThrow(
      'BASIC_AUTH_SECRET is not configured'
    );
  });

  it('rejects verification when no secret is configured', async () => {
    const token = await createSessionToken('alice', SECRET);
    const isValid = await verifySessionToken(token, null);
    expect(isValid).toBe(false);
  });

  it('warns when BASIC_AUTH_SECRET is not set in the environment', async () => {
    delete process.env.BASIC_AUTH_SECRET;

    await expect(createSessionToken('alice')).rejects.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('BASIC_AUTH_SECRET is not set')
    );
  });
});
