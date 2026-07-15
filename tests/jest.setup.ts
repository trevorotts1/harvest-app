// Test-only environment setup. This is NOT a real secret — it is a fixed literal committed to the
// repo purely so the suite has a deterministic, non-production pepper to key hmacForMatch()
// against (T-03 QC fix, defect 2/3). hmacForMatch() fails closed (throws) if CONTACT_HASH_PEPPER
// is unset, so this must be present before any test that imports contact.service.ts runs.
process.env.CONTACT_HASH_PEPPER =
  process.env.CONTACT_HASH_PEPPER || 'test-only-dummy-pepper-do-not-use-in-prod';
