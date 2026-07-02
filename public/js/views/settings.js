import { api } from '../api.js';
import { esc, toast, guard } from '../ui.js';
import { getIdentity, setIdentity } from '../state.js';

export const renderSettings = guard(async (root, ctx) => {
  ctx.setHead('Settings', 'Your identity is attached to every entry and signature');
  const u = getIdentity();
  let stt = { provider: 'webspeech', serverStt: false };
  try { stt = await api.sttHealth(); } catch {}

  root.innerHTML = `
    <div class="split">
      <div class="card">
        <h2 class="sec-t">Signing identity</h2>
        <label class="fld">Full name</label><input class="txt" id="sName" value="${esc(u.name)}" placeholder="e.g. Dr. Ian Yang"/>
        <label class="fld">Role</label><input class="txt" id="sRole" value="${esc(u.role)}" placeholder="e.g. Research Scientist"/>
        <label class="fld">Initials</label><input class="txt" id="sInit" value="${esc(u.initials)}" placeholder="e.g. IY" maxlength="4"/>
        <div class="row" style="margin-top:14px"><button class="btn" id="save">Save identity</button></div>
        <div class="hint">Sent with every API request so the audit trail can attribute each action. In production this maps to authenticated SSO / RBAC accounts.</div>
      </div>
      <div class="card">
        <h2 class="sec-t">Voice transcription</h2>
        <p class="muted" style="font-size:13px;margin-top:0">Current engine: <b>${esc(stt.provider)}</b> ${stt.serverStt ? '(server-side)' : '(browser Web Speech API)'}.</p>
        <div class="hint" style="margin-top:0">The browser Web Speech API streams audio to the browser vendor's cloud. For classified / on-prem labs, enable a self-hosted Whisper engine (see <span class="mono">src/routes/stt.js</span>) — the UI switches over automatically.</div>
        <h2 class="sec-t" style="margin-top:18px">About this deployment</h2>
        <p class="muted" style="font-size:13px">Data is stored in a server-side SQLite database and persists across restarts. Back it up by copying the <span class="mono">data/</span> volume.</p>
      </div>
    </div>`;

  root.querySelector('#save').onclick = () => {
    setIdentity({ name: root.querySelector('#sName').value.trim(), role: root.querySelector('#sRole').value.trim(), initials: root.querySelector('#sInit').value.trim() });
    toast('Identity saved'); ctx.go('settings');
  };
});
