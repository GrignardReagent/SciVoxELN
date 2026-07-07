/** Shared UI helpers: escaping, formatting, toasts, and modals. */

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmt = iso => iso ? new Date(iso).toLocaleString(undefined,
  { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export const fmtShort = iso => iso ? new Date(iso).toLocaleDateString(undefined,
  { month: 'short', day: '2-digit', year: 'numeric' }) : '—';

let flashT;
export function toast(msg, isErr = false) {
  const f = document.getElementById('flash');
  f.textContent = msg;
  f.classList.toggle('err', isErr);
  f.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(() => f.classList.remove('on'), 2600);
}

const autoGrowRegistry = new WeakSet();
let autoGrowObserver = null;
let autoGrowResizeInstalled = false;

export function autoGrowTextareas(root = document) {
  const found = [];
  if (root?.matches?.('textarea')) found.push(root);
  if (root?.querySelectorAll) found.push(...root.querySelectorAll('textarea'));
  found.forEach(prepareAutoGrowTextarea);
}

export function installTextareaAutoGrow(root = document.body) {
  autoGrowTextareas(root);
  if (!autoGrowResizeInstalled) {
    window.addEventListener('resize', () => autoGrowTextareas(root));
    autoGrowResizeInstalled = true;
  }
  if (autoGrowObserver || typeof MutationObserver === 'undefined') return;
  autoGrowObserver = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node.nodeType === 1) autoGrowTextareas(node);
      });
    });
  });
  autoGrowObserver.observe(root, { childList: true, subtree: true });
}

function prepareAutoGrowTextarea(el) {
  if (autoGrowRegistry.has(el)) {
    growTextarea(el);
    return;
  }
  autoGrowRegistry.add(el);
  el.dataset.autogrow = 'true';
  el.style.overflowY = 'hidden';
  el.addEventListener('input', () => growTextarea(el));
  el.addEventListener('change', () => growTextarea(el));
  growTextarea(el);
}

function growTextarea(el) {
  el.style.height = 'auto';
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
}

export function modal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('overlay').classList.add('on');
  autoGrowTextareas(document.getElementById('modal'));
}
export function closeModal() {
  document.getElementById('overlay').classList.remove('on');
}
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target.id === 'overlay') closeModal();
});

export function confirmModal(title, body, onYes, yesLabel = 'Confirm') {
  modal(`<h3>${title}</h3><p class="muted">${body}</p>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" data-x>Cancel</button>
      <button class="btn" data-yes>${yesLabel}</button></div>`);
  const m = document.getElementById('modal');
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-yes]').onclick = () => { closeModal(); onYes(); };
}

/** Wrap an async handler with error toasting. */
export function guard(fn) {
  return async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message || 'Error', true); } };
}
