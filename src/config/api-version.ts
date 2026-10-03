/**
 * URL prefix for the current API version. All versioned routes are registered under it,
 * so bumping it is the only change needed to cut a new version; older route modules can
 * then be re-registered under their previous prefix for a migration window.
 */
export const CURRENT_API_VERSION = "v1";
