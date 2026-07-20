/**
 * GitHub OAuth (Authorization Code + loopback redirect).
 *
 * Flow:
 * 1. Start a short-lived local HTTP server on 127.0.0.1 (wait until listening).
 * 2. Open the system browser to GitHub's authorize URL.
 * 3. GitHub redirects to http://127.0.0.1:<port>/callback?code=...&state=...
 * 4. Exchange the code for an access token using CLIENT_SECRET (main process only).
 */
const http = require('http');
const { URL } = require('url');
const { shell } = require('electron');
const { config, assertAuthConfig } = require('../config');
const logger = require('./logger');

class AuthError extends Error {
  constructor(message, code = 'AUTH_FAILED') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** Allows cancelling a previous in-flight login when the user clicks again. */
let activeLogin = null;

function buildAuthorizeUrl(state) {
  const url = new URL(config.github.oauthAuthorizeUrl);
  url.searchParams.set('client_id', config.github.clientId);
  url.searchParams.set('redirect_uri', config.github.redirectUri);
  url.searchParams.set('scope', config.github.scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

function htmlPage(title, body) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:Segoe UI,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.5;color:#1b1f23}
  code{background:#f6f8fa;padding:2px 6px;border-radius:4px}</style></head>
  <body><h1>${title}</h1>${body}</body></html>`;
}

/**
 * @returns {Promise<{ server: import('http').Server, codePromise: Promise<string>, cancel: (err?: Error) => void }>}
 */
function startCallbackServer(expectedState, timeoutMs = 180_000) {
  return new Promise((resolveListen, rejectListen) => {
    let settled = false;
    let codeResolve;
    let codeReject;

    const codePromise = new Promise((resolve, reject) => {
      codeResolve = resolve;
      codeReject = reject;
    });

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${config.oauth.callbackPort}`);

        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }

        const error = reqUrl.searchParams.get('error');
        const errorDesc = reqUrl.searchParams.get('error_description');
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            htmlPage(
              'Autenticación cancelada',
              `<p>${errorDesc || error}</p><p>Vuelve a la app y pulsa <strong>Iniciar sesión</strong> de nuevo.</p>`
            )
          );
          finish(new AuthError(errorDesc || error, 'AUTH_DENIED'));
          return;
        }

        // Ignore noisy/premature hits (extensions, manual visits) without aborting the login.
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            htmlPage(
              'Esperando autorización',
              '<p>Esta URL solo funciona como redirección de GitHub. Vuelve a la app y usa el botón de inicio de sesión.</p>'
            )
          );
          logger.warn('OAuth callback without code ignored');
          return;
        }

        if (state !== expectedState) {
          // Do NOT close the server — the real redirect may still arrive.
          logger.warn('OAuth state mismatch; keeping server open', {
            received: state,
            expected: expectedState,
          });
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            htmlPage(
              'Sesión de login desactualizada',
              `<p>Este enlace pertenece a un intento anterior de inicio de sesión.</p>
               <p>Cierra esta pestaña, vuelve a <strong>GitPushNotifier</strong> y pulsa
               <strong>Iniciar sesión con GitHub</strong> otra vez. No reutilices pestañas viejas ni pegues la URL a mano.</p>`
            )
          );
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          htmlPage(
            'GitPushNotifier',
            '<p>Autenticación correcta. Ya puedes cerrar esta ventana y volver a la app.</p>'
          )
        );
        finish(null, code);
      } catch (err) {
        logger.error('OAuth callback handler error', { message: err.message });
        try {
          res.writeHead(500);
          res.end('Error');
        } catch {
          // ignore
        }
      }
    });

    const timer = setTimeout(() => {
      finish(new AuthError('Se agotó el tiempo de OAuth. Inténtalo de nuevo desde la app.', 'AUTH_TIMEOUT'));
    }, timeoutMs);

    function finish(err, code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeLogin = null;
      server.close();
      if (err) codeReject(err);
      else codeResolve(code);
    }

    function cancel(err) {
      finish(err || new AuthError('Login cancelado', 'AUTH_CANCELLED'));
    }

    server.on('error', (err) => {
      const authErr = new AuthError(
        `No se pudo abrir el puerto ${config.oauth.callbackPort}: ${err.message}. Cierra otras instancias de la app e inténtalo de nuevo.`,
        'AUTH_SERVER_ERROR'
      );
      if (!settled && server.listening) {
        finish(authErr);
      } else {
        clearTimeout(timer);
        rejectListen(authErr);
      }
    });

    server.listen(config.oauth.callbackPort, '127.0.0.1', () => {
      logger.info('OAuth callback server listening', { port: config.oauth.callbackPort });
      resolveListen({ server, codePromise, cancel });
    });
  });
}

async function exchangeCodeForToken(code) {
  const response = await fetch(config.github.oauthTokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': config.appName,
    },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
      redirect_uri: config.github.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new AuthError(`Token exchange failed (HTTP ${response.status})`, 'AUTH_TOKEN_EXCHANGE');
  }

  const data = await response.json();
  if (data.error) {
    throw new AuthError(data.error_description || data.error, 'AUTH_TOKEN_EXCHANGE');
  }
  if (!data.access_token) {
    throw new AuthError('No access_token in GitHub response', 'AUTH_TOKEN_EXCHANGE');
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

/**
 * Starts the full browser-based OAuth login.
 * @returns {Promise<{ accessToken: string, tokenType: string, scope: string }>}
 */
async function loginWithGitHub() {
  assertAuthConfig();

  if (activeLogin) {
    logger.info('Cancelling previous OAuth attempt');
    activeLogin.cancel(new AuthError('Se inició un nuevo login', 'AUTH_CANCELLED'));
    activeLogin = null;
    // Brief pause so the port can be released
    await new Promise((r) => setTimeout(r, 300));
  }

  const state = `gpn_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const authorizeUrl = buildAuthorizeUrl(state);

  logger.info('Starting GitHub OAuth login');

  const session = await startCallbackServer(state);
  activeLogin = session;

  try {
    // Electron returns Promise<void> here (not a boolean). Do not treat a falsy
    // return value as failure — that closed the callback server immediately and
    // caused "127.0.0.1 rejected the connection" after GitHub redirected back.
    await shell.openExternal(authorizeUrl);
    logger.info('Browser opened for GitHub OAuth; waiting for callback');

    const code = await session.codePromise;
    logger.info('OAuth code received, exchanging for token');
    const token = await exchangeCodeForToken(code);
    logger.info('OAuth token obtained', { scope: token.scope });
    return token;
  } catch (err) {
    if (activeLogin === session) {
      session.cancel(err instanceof AuthError ? err : new AuthError(err.message || String(err)));
    }
    // Ignore cancellation from a superseded login attempt
    if (err instanceof AuthError && err.code === 'AUTH_CANCELLED') {
      throw err;
    }
    throw err;
  }
}

/**
 * Sign in with a Personal Access Token (classic or fine-grained).
 * Useful when an organization blocks third-party OAuth Apps but the user
 * is a collaborator and can use their own token.
 *
 * Classic PAT: enable the `repo` scope (private repos) or `public_repo`.
 * Fine-grained: grant read access to the target repository (Metadata + Contents is enough for events).
 *
 * @param {string} rawToken
 * @returns {Promise<{ accessToken: string, tokenType: string, scope: string }>}
 */
async function loginWithPat(rawToken) {
  const accessToken = String(rawToken || '').trim();
  if (!accessToken) {
    throw new AuthError('Pega un Personal Access Token válido.', 'AUTH_PAT_EMPTY');
  }
  if (accessToken.length < 20) {
    throw new AuthError('El token es demasiado corto.', 'AUTH_PAT_INVALID');
  }

  // Validate by calling /user (same client the rest of the app uses after setToken)
  const response = await fetch(`${config.github.apiBaseUrl}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': config.appName,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 401) {
    throw new AuthError('Token inválido o revocado.', 'TOKEN_INVALID');
  }
  if (!response.ok) {
    const body = await response.text();
    throw new AuthError(
      `No se pudo validar el token (HTTP ${response.status}). ${body.slice(0, 180)}`,
      'AUTH_PAT_FAILED'
    );
  }

  logger.info('PAT validated successfully');
  return {
    accessToken,
    tokenType: 'bearer',
    scope: 'pat',
  };
}

module.exports = {
  loginWithGitHub,
  loginWithPat,
  AuthError,
};
