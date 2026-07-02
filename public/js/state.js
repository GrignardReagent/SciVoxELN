/** Client-side identity (who is acting). Persisted locally; sent with every API call. */
const KEY = 'scivox_identity';
let identity = load();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { name: '', role: '', initials: '' }; }
  catch { return { name: '', role: '', initials: '' }; }
}
export function getIdentity() { return identity; }
export function setIdentity(next) {
  identity = { name: next.name || '', role: next.role || '', initials: next.initials || '' };
  try { localStorage.setItem(KEY, JSON.stringify(identity)); } catch {}
  return identity;
}
