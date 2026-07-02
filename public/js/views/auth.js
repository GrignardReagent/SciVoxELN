import { api } from '../api.js';
import { esc } from '../ui.js';

// All supported providers are shown; unconfigured ones render disabled with a hint.
const ALL_PROVIDERS = [
  { key: 'google', label: 'Google', ic: 'G' },
  { key: 'github', label: 'GitHub', ic: '⎔' },
  { key: 'wechat', label: 'WeChat', ic: '💬' }
];

/** Render the full-screen login/register experience. Calls onSuccess(user). */
export async function renderAuth(container, onSuccess) {
  let mode = 'login'; // 'login' | 'register'
  let enabled = new Set();
  try {
    const p = await api.providers();
    (p.oauth || []).forEach(o => enabled.add(o.key));
  } catch {}

  function oauthButton(p) {
    if (enabled.has(p.key)) {
      return `<a class="btn oauth oauth-${p.key}" href="/api/auth/oauth/${p.key}/start">
        <span class="oauth-ic">${p.ic}</span> Continue with ${esc(p.label)}</a>`;
    }
    return `<button class="btn oauth oauth-${p.key}" disabled title="Not configured — set ${p.key.toUpperCase()} credentials in .env">
      <span class="oauth-ic">${p.ic}</span> ${esc(p.label)} <span class="oauth-off">· off</span></button>`;
  }

  function draw() {
    container.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand"><img class="brand-icon" src="/icon.svg" alt="SciVox ELN" width="40" height="40"/>
          <div><b>SciVox ELN</b><div class="muted" style="font-size:12px">Voice &amp; Vision Electronic Lab Notebook</div></div></div>

        <div class="auth-tabs">
          <button class="auth-tab ${mode === 'login' ? 'on' : ''}" data-tab="login">Sign in</button>
          <button class="auth-tab ${mode === 'register' ? 'on' : ''}" data-tab="register">Create account</button>
        </div>

        <form id="authForm" autocomplete="on">
          ${mode === 'register' ? '<label class="fld">Full name</label><input class="txt" id="aName" placeholder="Dr. Ian Yang" autocomplete="name"/>' : ''}
          <label class="fld">Email</label>
          <input class="txt" id="aEmail" type="email" placeholder="you@lab.org" autocomplete="email" required/>
          <label class="fld">Password</label>
          <input class="txt" id="aPass" type="password" placeholder="${mode === 'register' ? 'At least 8 characters' : '••••••••'}" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" required/>
          <div class="auth-err" id="authErr"></div>
          <button class="btn" id="authSubmit" type="submit" style="width:100%;justify-content:center;margin-top:12px">
            ${mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>

        <div class="auth-or"><span>or continue with</span></div>
        <div class="oauth-list">${ALL_PROVIDERS.map(oauthButton).join('')}</div>

        <p class="muted" style="font-size:11px;text-align:center;margin:16px 0 0">
          ${mode === 'register' ? 'The first account created becomes the administrator.' : 'Access is restricted to registered lab members.'}
        </p>
      </div>`;

    container.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { mode = b.dataset.tab; draw(); });

    const form = container.querySelector('#authForm');
    const err = container.querySelector('#authErr');
    form.onsubmit = async e => {
      e.preventDefault();
      err.textContent = '';
      const email = container.querySelector('#aEmail').value.trim();
      const password = container.querySelector('#aPass').value;
      const btn = container.querySelector('#authSubmit');
      btn.disabled = true; btn.textContent = 'Please wait…';
      try {
        const user = mode === 'login'
          ? await api.login({ email, password })
          : await api.register({ email, name: container.querySelector('#aName').value.trim(), password });
        onSuccess(user);
      } catch (ex) {
        err.textContent = ex.message || 'Something went wrong';
        btn.disabled = false; btn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      }
    };
  }
  draw();
}
