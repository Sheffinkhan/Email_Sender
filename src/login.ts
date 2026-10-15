import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'es_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * A single shared password for the online version. Sessions are signed
 * cookies, so nothing is stored server-side; changing the password signs
 * everyone out.
 */
export function createLoginGate(password: string, now: () => number = Date.now) {
  // A slow derivation, so a stolen session cookie cannot be used to guess the password offline.
  const key = scryptSync(password, 'email-sender session', 32);
  const sign = (expires: number) => createHmac('sha256', key).update(String(expires)).digest('base64url');

  return {
    checkPassword(attempt: unknown): boolean {
      // Comparing fixed-length digests keeps the check constant-time.
      return typeof attempt === 'string' && timingSafeEqual(digest(attempt), digest(password));
    },

    /** A Set-Cookie value for a new session. */
    issue(): string {
      const expires = now() + MAX_AGE_SECONDS * 1000;
      return `${COOKIE}=${expires}.${sign(expires)}; ${ATTRIBUTES}; Max-Age=${MAX_AGE_SECONDS}`;
    },

    /** A Set-Cookie value that ends the session. */
    clear(): string {
      return `${COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
    },

    isSignedIn(cookieHeader: string | undefined): boolean {
      const value = cookieHeader
        ?.split(/;\s*/)
        .find((part) => part.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);
      const [expires, signature] = value?.split('.') ?? [];
      if (!expires || !signature || !(Number(expires) > now())) return false;
      const expected = Buffer.from(sign(Number(expires)));
      const given = Buffer.from(signature);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
  };
}

export type LoginGate = ReturnType<typeof createLoginGate>;
