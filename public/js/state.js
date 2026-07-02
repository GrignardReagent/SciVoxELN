/** Current authenticated user, held in memory for the session. Identity now
 *  comes from the server (session cookie), not client-side storage. */
let currentUser = null;

export function getUser() { return currentUser; }
export function setUser(u) { currentUser = u || null; return currentUser; }
export function isAdmin() { return !!currentUser && currentUser.role === 'admin'; }
export function initials(u = currentUser) {
  if (!u) return '?';
  const base = u.name || u.email || '?';
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || base[0].toUpperCase();
}
