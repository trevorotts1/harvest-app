// Test-only environment setup. This is NOT a real secret — it is a fixed literal committed to the
// repo purely so the suite has a deterministic, non-production pepper to key hmacForMatch()
// against (T-03 QC fix, defect 2/3). hmacForMatch() fails closed (throws) if CONTACT_HASH_PEPPER
// is unset, so this must be present before any test that imports contact.service.ts runs.
process.env.CONTACT_HASH_PEPPER =
  process.env.CONTACT_HASH_PEPPER || 'test-only-dummy-pepper-do-not-use-in-prod';

// Test-only AES-256 key (T-12) — a fixed, committed, non-production literal so the suite has a
// deterministic 32-byte base64 key to encrypt/decrypt TOTP secrets against. getMfaEncryptionKey()
// (src/lib/auth/env.ts) fails closed (throws) if MFA_ENCRYPTION_KEY is unset, so this must be
// present before any test that enrolls/verifies MFA runs. Generated once via
// `openssl rand -base64 32`-equivalent (node crypto.randomBytes(32).toString('base64')) — it is
// not a real secret and grants no access to anything; it only needs to be a valid-length key.
process.env.MFA_ENCRYPTION_KEY =
  process.env.MFA_ENCRYPTION_KEY || 'FBNitMs5Dih2gQFcdEl7aNbttiyOLAH1yODMjwFXlSw=';

// Test-only AES-256 key (T-18, §6.4/§16.3) — a fixed, committed, non-production literal so the suite
// has a deterministic 32-byte base64 key to encrypt/decrypt the Seven Whys transcript and anchor
// statement against. getWhySessionEncryptionKey() (src/services/onboarding/wp01/seven-whys/
// persistence.ts) fails closed (throws) if WHY_SESSION_ENCRYPTION_KEY is unset. Generated the same
// way as MFA_ENCRYPTION_KEY above — not a real secret, grants no access to anything.
process.env.WHY_SESSION_ENCRYPTION_KEY =
  process.env.WHY_SESSION_ENCRYPTION_KEY || 'lQXnLFZxlfUdACHf6z1lP+cUH49yYYW50Bgw0zG1jjk=';
