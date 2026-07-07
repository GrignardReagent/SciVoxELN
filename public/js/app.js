/** App shell: authentication gating, navigation, mobile drawer, and routing. */
import { api } from './api.js';
import { getUser, setUser, isAdmin, initials } from './state.js';
import { renderAuth } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderExperiments, renderExperiment } from './views/experiments.js';
import { renderEntries } from './views/entries.js';
import { renderProjects } from './views/projects.js';
import { renderPlanner } from './views/planner.js';
import { renderInventory } from './views/inventory.js';
import { renderAudit } from './views/audit.js';
import { renderUsers } from './views/users.js';
import { renderSettings } from './views/settings.js';
import { installTextareaAutoGrow, toast } from './ui.js';
import { initTheme, toggleMode } from './theme.js';

initTheme();
installTextareaAutoGrow(document.body);

const content = document.getElementById('content');
const appRoot = document.getElementById('appRoot');
const authScreen = document.getElementById('authScreen');
const state = { view: 'dashboard', params: {}, search: '' };

const views = {
  dashboard: () => renderDashboard(content, ctx),
  experiments: () => state.params.id ? renderExperiment(content, ctx, state.params.id) : renderExperiments(content, ctx),
  entries: () => renderEntries(content, ctx),
  projects: () => renderProjects(content, ctx),
  planner: () => renderPlanner(content, ctx),
  inventory: () => renderInventory(content, ctx),
  audit: () => renderAudit(content, ctx),
  users: () => renderUsers(content, ctx),
  settings: () => renderSettings(content, ctx)
};

const ctx = {
  go,
  get search() { return state.search; },
  setHead,
  refresh: () => views[state.view] && views[state.view](),
  logout,
  get user() { return getUser(); }
};

function setHead(title, sub = '') {
  document.getElementById('topTitle').textContent = title;
  document.getElementById('topSub').textContent = sub;
}

function go(view, params = {}) {
  if (view === 'users' && !isAdmin()) view = 'dashboard';
  state.view = view; state.params = params;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  closeDrawer();
  (views[view] || views.dashboard)();
}

/* ---------------- auth gating ---------------- */
async function boot() {
  try {
    const user = await api.me();
    setUser(user);
    showApp();
  } catch {
    showAuth();
  }
}

function showAuth() {
  appRoot.style.display = 'none';
  authScreen.style.display = 'flex';
  renderAuth(authScreen, user => { setUser(user); showApp(); });
}

function showApp() {
  authScreen.style.display = 'none';
  appRoot.style.display = '';
  const u = getUser();
  document.getElementById('userFoot').textContent = u.name || u.email || 'User';
  document.getElementById('roleFoot').textContent = u.role === 'admin' ? 'Administrator' : 'User';
  document.getElementById('avaFoot').textContent = initials(u);
  document.querySelectorAll('[data-admin]').forEach(el => el.style.display = isAdmin() ? '' : 'none');
  go('dashboard');
}

async function logout() {
  try { await api.logout(); } catch {}
  setUser(null);
  showAuth();
}

/* ---------------- wiring ---------------- */
document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
document.getElementById('logoutBtn').addEventListener('click', logout);

const searchBox = document.getElementById('globalSearch');
searchBox.addEventListener('input', e => {
  state.search = e.target.value.trim().toLowerCase();
  if (['experiments', 'entries', 'projects', 'inventory', 'audit', 'planner', 'users'].includes(state.view) && !state.params.id) views[state.view]();
});

// Session expiry mid-use → back to login
window.addEventListener('scivox:unauthorized', () => { setUser(null); showAuth(); toast('Session expired — please sign in', true); });

/* mobile drawer */
const side = document.getElementById('side');
const scrim = document.getElementById('scrim');
function openDrawer() { side.classList.add('open'); scrim.classList.add('on'); }
function closeDrawer() { side.classList.remove('open'); scrim.classList.remove('on'); }
document.getElementById('hamburger').addEventListener('click', openDrawer);
scrim.addEventListener('click', closeDrawer);
document.getElementById('themeToggle').addEventListener('click', () => { toggleMode(); if (state.view === 'settings') ctx.refresh(); });

window.__scivox = { go };
boot();
