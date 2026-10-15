import { describe, expect, it } from 'vitest';
import { createLoginGate } from '../src/login.js';

const cookieOf = (setCookie: string) => setCookie.split(';')[0];

describe('login gate', () => {
  it('accepts only the exact password', () => {
    const gate = createLoginGate('correct horse battery');
    expect(gate.checkPassword('correct horse battery')).toBe(true);
    expect(gate.checkPassword('correct horse batter')).toBe(false);
    expect(gate.checkPassword('')).toBe(false);
    expect(gate.checkPassword(undefined)).toBe(false);
    expect(gate.checkPassword(['correct horse battery'])).toBe(false);
  });

  it('recognises its own session among other cookies', () => {
    const gate = createLoginGate('correct horse battery');
    const cookie = cookieOf(gate.issue());
    expect(gate.isSignedIn(cookie)).toBe(true);
    expect(gate.isSignedIn(`theme=dark; ${cookie}; other=1`)).toBe(true);
  });

  it('rejects missing, tampered or foreign sessions', () => {
    const gate = createLoginGate('correct horse battery');
    const cookie = cookieOf(gate.issue());
    const [name, value] = cookie.split('=');
    const [expires, signature] = value.split('.');

    expect(gate.isSignedIn(undefined)).toBe(false);
    expect(gate.isSignedIn('es_session=')).toBe(false);
    expect(gate.isSignedIn(`${name}=${Number(expires) + 1000}.${signature}`)).toBe(false);
    expect(gate.isSignedIn(`${name}=${expires}.${signature.slice(0, -2)}`)).toBe(false);
    expect(gate.isSignedIn(`${name}=${expires}.${'A'.repeat(signature.length)}`)).toBe(false);
    expect(gate.isSignedIn(`${name}=never.${signature}`)).toBe(false);
    // A new password signs everyone out.
    expect(createLoginGate('another long password').isSignedIn(cookie)).toBe(false);
  });

  it('expires sessions after a week', () => {
    let now = 1_000_000;
    const gate = createLoginGate('correct horse battery', () => now);
    const cookie = cookieOf(gate.issue());
    now += 7 * 24 * 60 * 60 * 1000 - 1;
    expect(gate.isSignedIn(cookie)).toBe(true);
    now += 1;
    expect(gate.isSignedIn(cookie)).toBe(false);
  });

  it('builds cookies the browser keeps away from scripts and other sites', () => {
    const gate = createLoginGate('correct horse battery');
    expect(gate.issue()).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
    expect(gate.clear()).toBe('es_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  });
});
