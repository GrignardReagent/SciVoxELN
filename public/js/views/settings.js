import { api } from '../api.js';
import { esc, guard } from '../ui.js';
import { getUser } from '../state.js';
import { getConfig, SLOTS, setMode, setPaletteColor, resetPalette } from '../theme.js';

export const renderSettings = guard(async (root, ctx) => {
  ctx.setHead('Settings', 'Your account, appearance and this deployment');
  const u = getUser();
  let stt = { provider: 'webspeech', serverStt: false };
  try { stt = await api.sttHealth(); } catch {}

  const draw = () => {
    const cfg = getConfig();
    const mode = cfg.mode;
    const palette = cfg.palettes[mode];
    const swatches = palette.map((c, i) => `
      <div class="swatch">
        <label>${esc(SLOTS[mode][i])}</label>
        <code>${esc(c)}</code>
        <input type="color" value="${esc(c)}" data-ci="${i}"/>
      </div>`).join('');

    root.innerHTML = `
      <div class="split">
        <div class="card">
          <h2 class="sec-t">Your account</h2>
          <div class="row" style="gap:14px;margin-bottom:8px">
            <div class="ava" style="width:44px;height:44px;font-size:16px">${esc((u.name || u.email || '?')[0].toUpperCase())}</div>
            <div><div style="font-weight:600">${esc(u.name || '—')}</div><div class="muted" style="font-size:13px">${esc(u.email || 'no email')}</div></div>
          </div>
          <div class="hint" style="margin-top:0">Role: <b>${u.role === 'admin' ? 'Administrator' : 'User'}</b> · sign-in via <b>${esc(u.provider || 'password')}</b></div>
          <p class="muted" style="font-size:12px">Your identity is attached to every entry, signature and audit event automatically.</p>
          <button class="btn ghost sm" id="logout">Sign out</button>

          <h2 class="sec-t" style="margin-top:20px">Voice transcription</h2>
          <p class="muted" style="font-size:13px;margin-top:0">Engine: <b>${esc(stt.provider)}</b> ${stt.serverStt ? '(self-hosted Whisper)' : '(browser Web Speech API)'}.</p>
          <div class="hint" style="margin-top:0">Web Speech streams audio to the browser vendor's cloud. For on-prem labs, run the Whisper profile and the app switches automatically.</div>
        </div>

        <div class="card">
          <h2 class="sec-t">Appearance</h2>
          <div class="mode-choice">
            <button data-mode="light" class="${mode === 'light' ? 'on' : ''}">☀ Light</button>
            <button data-mode="dark" class="${mode === 'dark' ? 'on' : ''}">🌙 Dark</button>
          </div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">Customise the ${mode} palette. Changes apply live and are saved on this device.</p>
          <div class="swatches">${swatches}</div>
          <div class="row" style="margin-top:12px">
            <button class="btn ghost sm" id="resetPalette">Reset ${mode} to defaults</button>
          </div>
          <div class="hint">Defaults — light: #0081a7 #00afb9 #fdfcdc #fed9b7 #f07167 · dark: #0b132b #1c2541 #3a506b #5bc0be #6fffe9</div>

          <h2 class="sec-t" style="margin-top:18px">Data</h2>
          <p class="muted" style="font-size:13px">Stored server-side in SQLite; persists across restarts. Back up by copying the <span class="mono">data/</span> volume.</p>
        </div>
      </div>`;

    root.querySelector('#logout').onclick = () => ctx.logout();
    root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { setMode(b.dataset.mode); draw(); });
    root.querySelectorAll('input[data-ci]').forEach(inp => inp.oninput = () => { setPaletteColor(mode, +inp.dataset.ci, inp.value); draw(); });
    root.querySelector('#resetPalette').onclick = () => { resetPalette(mode); draw(); };
  };
  draw();
});
