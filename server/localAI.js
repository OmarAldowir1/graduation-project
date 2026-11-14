import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createPageAIHandler} from '../supabase/functions/cloudflare-page-ai/handler.js';
import {createTextAIHandler} from '../supabase/functions/text-ai/handler.js';

const secretFile = fileURLToPath(new URL('../supabase/functions/.env', import.meta.url));
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function readSecrets() {
  try {
    return Object.fromEntries(readFileSync(secretFile, 'utf8').split(/\r?\n/)
      .filter(line => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map(line => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }));
  } catch {
    return {};
  }
}

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function localAIPlugin(publicEnv) {
  return {
    name: 'motion-local-ai',
    configureServer(server) {
      const secrets = readSecrets();
      const base = publicEnv.VITE_SUPABASE_URL;
      const publicKey = publicEnv.VITE_SUPABASE_ANON_KEY;
      const env = name => {
        if (name !== 'MOTION_AI_ALLOWED_ORIGINS') return secrets[name];
        const port = server.httpServer?.address()?.port || 5173;
        return [secrets[name], `http://localhost:${port}`, `http://127.0.0.1:${port}`].filter(Boolean).join(',');
      };
      const headers = token => ({apikey: publicKey, Authorization: token, 'Content-Type': 'application/json'});
      const authenticate = async token => {
        const response = await fetch(`${base}/auth/v1/user`, {headers: headers(token), signal: AbortSignal.timeout(10000)});
        return response.ok ? response.json() : null;
      };
      const reserveQuota = async token => {
        const response = await fetch(`${base}/rest/v1/rpc/reserve_page_ai_request`, {
          method: 'POST', headers: headers(token), body: '{}', signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('AI quota storage unavailable');
        return response.json();
      };
      const authorizePage = async (token, pageId) => {
        const response = await fetch(`${base}/rest/v1/pages?select=id&id=eq.${pageId}&limit=1`, {
          headers: headers(token), signal: AbortSignal.timeout(10000)
        });
        return response.ok && (await response.json()).length === 1;
      };
      const handlers = {
        '/cloudflare-page-ai': createPageAIHandler({env, authenticate, reserveQuota, authorizePage}),
        '/text-ai': createTextAIHandler({env, authenticate, reserveQuota})
      };
      server.middlewares.use('/__motion_ai', async (req, res, next) => {
        const handler = handlers[req.url?.split('?')[0]];
        if (!handler) return next();
        if (!loopback.has(req.socket.remoteAddress)) {
          return reply(res, 403, {error: {code: 'LOCAL_ONLY', message: 'Local AI is only available on this Mac.'}});
        }
        try {
          const chunks = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 200000) return reply(res, 413, {error: {code: 'TOO_LARGE', message: 'AI request is too large.'}});
            chunks.push(chunk);
          }
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: Object.fromEntries(['origin', 'authorization', 'content-type']
              .filter(name => req.headers[name]).map(name => [name, req.headers[name]])),
            ...(['POST', 'PUT', 'PATCH'].includes(req.method) ? {body: Buffer.concat(chunks)} : {})
          });
          const response = await handler(request);
          res.statusCode = response.status;
          for (const [name, value] of response.headers) res.setHeader(name, value);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          reply(res, 503, {error: {code: 'SERVICE_UNAVAILABLE', message: 'Local AI is unavailable right now.'}});
        }
      });
    }
  };
}
