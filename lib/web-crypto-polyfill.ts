import { requireOptionalNativeModule } from 'expo-modules-core';

// Type-only: erased at build time, so it never pulls the native module in.
import type { CryptoDigestAlgorithm } from 'expo-crypto';

/**
 * Enough of the web platform for Supabase's PKCE flow, and nothing more.
 *
 * @supabase/auth-js hashes the PKCE verifier with `crypto.subtle.digest` and,
 * finding no WebCrypto in Hermes, falls back to `code_challenge_method=plain`
 * — which sends the verifier itself as the challenge, so anything able to read
 * the authorize request could redeem the code. Backing `digest` with
 * expo-crypto restores S256, where only the hash ever leaves the device.
 *
 * Its S256 path also calls `new TextEncoder()` and `btoa()`. Hermes may or may
 * not provide those depending on the version, and enabling the path without
 * them would turn a warning into a failed Google sign-in, so both are filled
 * in here when missing. Every install is guarded: a runtime that already has a
 * real implementation keeps it.
 *
 * expo-crypto is a native module, so a binary built before it was added does
 * not contain it. It is therefore looked up optionally and imported lazily:
 * importing it at the top level threw on such builds and took the whole app
 * down at startup, which is far worse than the plain-challenge warning this
 * file exists to remove. Without it, auth-js simply keeps its old fallback.
 */

const globals = globalThis as Record<string, unknown>;

/** UTF-8 only, which is all the spec's default encoder does and all PKCE needs. */
if (typeof globals.TextEncoder === 'undefined') {
  globals.TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8';
    encode(input = ''): Uint8Array {
      const bytes: number[] = [];
      for (let i = 0; i < input.length; i++) {
        let point = input.charCodeAt(i);
        // Re-join a surrogate pair into the code point it represents.
        if (point >= 0xd800 && point <= 0xdbff && i + 1 < input.length) {
          const low = input.charCodeAt(i + 1);
          if (low >= 0xdc00 && low <= 0xdfff) {
            point = (point - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
            i++;
          }
        }
        if (point < 0x80) bytes.push(point);
        else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
        else if (point < 0x10000)
          bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
        else
          bytes.push(
            0xf0 | (point >> 18),
            0x80 | ((point >> 12) & 0x3f),
            0x80 | ((point >> 6) & 0x3f),
            0x80 | (point & 0x3f)
          );
      }
      return new Uint8Array(bytes);
    }
  };
}

/** auth-js passes a binary string, one character per byte, as btoa expects. */
if (typeof globals.btoa === 'undefined') {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  globals.btoa = (input: string): string => {
    let out = '';
    for (let i = 0; i < input.length; i += 3) {
      const a = input.charCodeAt(i);
      const b = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
      const c = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
      if (a > 0xff || b > 0xff || c > 0xff) {
        throw new Error('btoa: the string contains characters outside the Latin1 range');
      }
      const triplet = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
      out += ALPHABET[(triplet >> 18) & 0x3f] + ALPHABET[(triplet >> 12) & 0x3f];
      out += Number.isNaN(b) ? '=' : ALPHABET[(triplet >> 6) & 0x3f];
      out += Number.isNaN(c) ? '=' : ALPHABET[triplet & 0x3f];
    }
    return out;
  };
}

const existing = globals.crypto as { subtle?: unknown; getRandomValues?: unknown } | undefined;
const hasNativeCrypto = !!requireOptionalNativeModule('ExpoCrypto');

if (!existing?.subtle && hasNativeCrypto) {
  // Required lazily: the module reference must not be evaluated on a runtime
  // that lacks it, which is exactly what the check above establishes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as typeof import('expo-crypto');

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: {
      ...existing,
      subtle: {
        digest: (algorithm: string | { name: string }, data: BufferSource) => {
          const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
          return Crypto.digest(name.toUpperCase() as CryptoDigestAlgorithm, data);
        },
      },
      getRandomValues:
        typeof existing?.getRandomValues === 'function'
          ? (existing.getRandomValues as (array: never) => never).bind(existing)
          : Crypto.getRandomValues,
    },
  });
}
