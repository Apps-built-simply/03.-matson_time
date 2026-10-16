const MATSON_CONFIG = {
  assistantEndpoint: "/api/assistant",
  assistantTimeoutMs: 35000
};

// Application feature flags. Centralized so access gating lives in one place.
// To re-enable the Progress page, set progressAccess: true. No code changes
// beyond this flag are required to restore normal Progress access.
const MATSON_FEATURES = {
  progressAccess: false
};
