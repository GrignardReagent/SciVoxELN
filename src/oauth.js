/**
 * OAuth2 login flows for Google, GitHub and WeChat — implemented with plain
 * fetch (no passport). Each provider is enabled only when its client
 * credentials are present in the environment, so the app runs fine with none
 * configured (email/password still works).
 *
 * Required env per provider. BASE_URL is optional:
 * when set, OAuth callbacks use that fixed public URL; when blank, callbacks
 * are inferred from the current request host/protocol, which is useful for
 * temporary prototype tunnel URLs.
 *
 *   Google : GOOGLE_CLIENT_ID,  GOOGLE_CLIENT_SECRET
 *   GitHub : GITHUB_CLIENT_ID,  GITHUB_CLIENT_SECRET
 *   WeChat : WECHAT_APPID,      WECHAT_SECRET         (Open Platform "Website App")
 *
 * Register each provider's callback URL as:
 *   {BASE_URL}/api/auth/oauth/{provider}/callback
 */

function firstHeader(value) {
  const raw = Array.isArray(value) ? value[0] : (value || '');
  return raw.split(',')[0].trim();
}

function publicBaseUrl(req) {
  const configured = (process.env.BASE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');

  const forwardedHost = firstHeader(req?.headers?.['x-forwarded-host']);
  const host = forwardedHost || req?.headers?.host || `localhost:${process.env.PORT || 3000}`;
  const forwardedProto = firstHeader(req?.headers?.['x-forwarded-proto']);
  const proto = forwardedProto || req?.protocol || 'http';
  return `${proto}://${host}`.replace(/\/$/, '');
}
export const redirectUri = (provider, req) => `${publicBaseUrl(req)}/api/auth/oauth/${provider}/callback`;

async function form(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers },
    body: new URLSearchParams(body).toString()
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}
async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

export const providers = {
  google: {
    label: 'Google',
    enabled: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authorizeUrl(state, req) {
      const p = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri('google', req),
        response_type: 'code',
        scope: 'openid email profile',
        state, access_type: 'online', prompt: 'select_account'
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },
    async profile(code, req) {
      const tok = await form('https://oauth2.googleapis.com/token', {
        code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri('google', req), grant_type: 'authorization_code'
      });
      const u = await getJSON('https://openidconnect.googleapis.com/v1/userinfo', { authorization: `Bearer ${tok.access_token}` });
      return { providerId: u.sub, email: u.email || null, name: u.name || u.email || 'Google user' };
    }
  },

  github: {
    label: 'GitHub',
    enabled: () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    authorizeUrl(state, req) {
      const p = new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        redirect_uri: redirectUri('github', req),
        scope: 'read:user user:email', state
      });
      return `https://github.com/login/oauth/authorize?${p}`;
    },
    async profile(code, req) {
      const tok = await form('https://github.com/login/oauth/access_token', {
        code, client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET,
        redirect_uri: redirectUri('github', req)
      });
      const headers = { authorization: `Bearer ${tok.access_token}`, 'user-agent': 'SciVox-ELN' };
      const u = await getJSON('https://api.github.com/user', headers);
      let email = u.email;
      if (!email) {
        try {
          const emails = await getJSON('https://api.github.com/user/emails', headers);
          const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
          email = primary ? primary.email : null;
        } catch {}
      }
      return { providerId: String(u.id), email, name: u.name || u.login || 'GitHub user' };
    }
  },

  wechat: {
    label: 'WeChat',
    enabled: () => !!(process.env.WECHAT_APPID && process.env.WECHAT_SECRET),
    authorizeUrl(state, req) {
      const p = new URLSearchParams({
        appid: process.env.WECHAT_APPID,
        redirect_uri: redirectUri('wechat', req),
        response_type: 'code', scope: 'snsapi_login', state
      });
      // WeChat requires the #wechat_redirect fragment.
      return `https://open.weixin.qq.com/connect/qrconnect?${p}#wechat_redirect`;
    },
    async profile(code, _req) {
      const tok = await getJSON(`https://api.weixin.qq.com/sns/oauth2/access_token?${new URLSearchParams({
        appid: process.env.WECHAT_APPID, secret: process.env.WECHAT_SECRET, code, grant_type: 'authorization_code'
      })}`);
      if (tok.errcode) throw new Error(`WeChat: ${tok.errmsg}`);
      const info = await getJSON(`https://api.weixin.qq.com/sns/userinfo?${new URLSearchParams({
        access_token: tok.access_token, openid: tok.openid
      })}`);
      // Prefer unionid (stable across the WeChat Open Platform) when available.
      return { providerId: tok.unionid || info.unionid || tok.openid, email: null, name: info.nickname || 'WeChat user' };
    }
  }
};

export function enabledProviders() {
  return Object.entries(providers).filter(([, p]) => p.enabled()).map(([key, p]) => ({ key, label: p.label }));
}
