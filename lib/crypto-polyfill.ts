import { getRandomValues } from 'expo-crypto';

// Hermes has no WebCrypto. supabase-js creates the PKCE code verifier with
// crypto.getRandomValues when it exists and silently falls back to
// Math.random otherwise, so give it a cryptographically secure one. Imported
// first thing in lib/supabase.ts, before the client is created.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) {
  g.crypto = { getRandomValues };
} else if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = getRandomValues;
}
