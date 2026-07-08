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
const autoGrowWidths = new WeakMap();
let autoGrowObserver = null;
let autoGrowResizeInstalled = false;
let autoGrowValuePatchInstalled = false;
let autoGrowTextareaResizeObserver = null;

export function autoGrowTextareas(root = document) {
  const found = [];
  if (root?.matches?.('textarea')) found.push(root);
  if (root?.querySelectorAll) found.push(...root.querySelectorAll('textarea'));
  found.forEach(prepareAutoGrowTextarea);
}

export function installTextareaAutoGrow(root = document.body) {
  installTextareaValueAutoGrow();
  autoGrowTextareas(root);
  if (!autoGrowResizeInstalled) {
    window.addEventListener('resize', () => autoGrowTextareas(root));
    autoGrowResizeInstalled = true;
  }
  if (autoGrowObserver || typeof MutationObserver === 'undefined') return;
  autoGrowObserver = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'attributes') {
        autoGrowTextareas(record.target);
        return;
      }
      record.addedNodes.forEach(node => {
        if (node.nodeType === 1) autoGrowTextareas(node);
      });
    });
  });
  // NB: do NOT observe 'style'. growTextarea() writes el.style.height on every
  // fit; watching 'style' here would make each write re-trigger the observer,
  // which refits, which writes style again — an infinite feedback loop that
  // floods the microtask queue and hard-freezes the tab. Reveal/resize cases
  // are already covered by childList, the 'hidden'/'class' watches, and the
  // ResizeObserver (width 0 -> N on reveal) in observeTextareaResize().
  autoGrowObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'class']
  });
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
  el.addEventListener('change', () => scheduleGrowTextarea(el));
  el.addEventListener('focus', () => scheduleGrowTextarea(el));
  observeTextareaResize(el);
  growTextarea(el);
}

function installTextareaValueAutoGrow() {
  if (autoGrowValuePatchInstalled || typeof HTMLTextAreaElement === 'undefined') return;
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (!valueDescriptor?.get || !valueDescriptor?.set || !valueDescriptor.configurable) return;
  Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
    configurable: valueDescriptor.configurable,
    enumerable: valueDescriptor.enumerable,
    get: valueDescriptor.get,
    set(value) {
      valueDescriptor.set.call(this, value);
      if (this.dataset?.autogrow === 'true') scheduleGrowTextarea(this);
    }
  });
  autoGrowValuePatchInstalled = true;
}

function observeTextareaResize(el) {
  if (typeof ResizeObserver === 'undefined') return;
  if (!autoGrowTextareaResizeObserver) {
    autoGrowTextareaResizeObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const width = Math.round(entry.contentRect.width || 0);
        if (!width || autoGrowWidths.get(entry.target) === width) return;
        autoGrowWidths.set(entry.target, width);
        scheduleGrowTextarea(entry.target);
      });
    });
  }
  autoGrowTextareaResizeObserver.observe(el);
}

function scheduleGrowTextarea(el) {
  if (el.dataset.autogrowQueued === 'true') return;
  el.dataset.autogrowQueued = 'true';
  const run = () => {
    delete el.dataset.autogrowQueued;
    growTextarea(el);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else queueMicrotask(run);
}

function growTextarea(el) {
  if (el.clientWidth === 0 && el.scrollHeight === 0) return;
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
