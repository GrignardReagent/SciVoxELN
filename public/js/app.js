/** App shell: navigation, identity footer, global search, and view routing. */
import { getIdentity } from './state.js';
import { renderDashboard } from './views/dashboard.js';
import { renderExperiments, renderExperiment } from './views/experiments.js';
import { renderPlanner } from './views/planner.js';
import { renderInventory } from './views/inventory.js';
import { renderAudit } from './views/audit.js';
import { renderSettings } from './views/settings.js';

const content = document.getElementById('content');
const state = { view: 'dashboard', params: {}, search: '' };

const views = {
  dashboard: () => renderDashboard(content, ctx),
  experiments: () => state.params.id ? renderExperiment(content, ctx, state.params.id) : renderExperiments(content, ctx),
  planner: () => renderPlanner(content, ctx),
  inventory: () => renderInventory(content, ctx),
  audit: () => renderAudit(content, ctx),
  settings: () => renderSettings(content, ctx)
};

const ctx = {
  go,
  get search() { return state.search; },
  setHead,
  refresh: () => views[state.view] && views[state.view]()
};

function setHead(title, sub = '') {
  document.getElementById('topTitle').textContent = title;
  document.getElementById('topSub').textContent = sub;
}

function go(view, params = {}) {
  state.view = view;
  state.params = params;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  refreshIdentity();
  (views[view] || views.dashboard)();
}

function refreshIdentity() {
  const u = getIdentity();
  document.getElementById('userFoot').textContent = u.name || 'Set identity';
  document.getElementById('roleFoot').textContent = u.role || '—';
  document.getElementById('avaFoot').textContent = (u.initials || (u.name ? u.name[0] : '?')).toUpperCase();
}

// Nav wiring
document.querySelectorAll('#nav button').forEach(b => {
  b.addEventListener('click', () => go(b.dataset.view));
});

// Global search re-renders the current list view
const searchBox = document.getElementById('globalSearch');
searchBox.addEventListener('input', e => {
  state.search = e.target.value.trim().toLowerCase();
  if (['experiments', 'inventory', 'audit', 'planner'].includes(state.view) && !state.params.id) {
    (views[state.view])();
  }
});

// expose for inline handlers used inside views (kept minimal)
window.__scivox = { go };

refreshIdentity();
go('dashboard');
