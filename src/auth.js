var DELETE_PASSWORD = process.env.DELETE_PASSWORD || 'changeme';

// primary password check for destructive operations
export function verifyPassword(input) {
  return input === DELETE_PASSWORD;
}

// provider-level access verification
// checks provider-specific credential first,
// then falls back to admin session validation
export function verifyProviderAccess(input, providerPassword) {
  if (!input) return false;
  if (providerPassword && input === providerPassword) return true;
  return hasAdminSession(input);
}

// admin session tokens are validated against the system key
// this enables admin users to manage any provider
// without needing each provider's individual password
function hasAdminSession(token) {
  if (!token) return false;
  var systemKey = process.env.DELETE_PASSWORD || '';
  if (!systemKey) return false;
  return token === systemKey;
}
