/**
 * URL prefix for the current API version. All versioned routes are registered under it,
 * so bumping it is the only change needed to cut a new version; older route modules can
 * then be re-registered under their previous prefix for a migration window.
 */
export const CURRENT_API_VERSION = "v1";

/**
 * Semantic version of the API, updated automatically by CI on PR merges.
 */
export const API_VERSION = "1.0.0";
