import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_LENGTH = 16;
const HASH_LENGTH = 64;
const SALT_ENCODED_LENGTH = 22;
const HASH_ENCODED_LENGTH = 86;
const STORED_LENGTH = 116;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(plain, salt, HASH_LENGTH);
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.length !== STORED_LENGTH) return false;

  const parts = stored.split(':');
  if (parts.length !== 3) return false;

  const [scheme, saltB64, hashB64] = parts;
  if (
    scheme !== 'scrypt' ||
    saltB64.length !== SALT_ENCODED_LENGTH ||
    hashB64.length !== HASH_ENCODED_LENGTH ||
    !BASE64URL_PATTERN.test(saltB64) ||
    !BASE64URL_PATTERN.test(hashB64)
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    if (
      salt.length !== SALT_LENGTH ||
      expected.length !== HASH_LENGTH ||
      salt.toString('base64url') !== saltB64 ||
      expected.toString('base64url') !== hashB64
    ) {
      return false;
    }

    const actual = await scrypt(plain, salt, HASH_LENGTH);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
