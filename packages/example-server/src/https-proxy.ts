import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import httpProxy from 'http-proxy';
import { fileURLToPath } from 'node:url';

export type HttpsProxyOverrides = {
  httpsPort?: number;
  target?: string;
  keyFile?: string;
  certFile?: string;
  caFile?: string;
};

type HttpsProxyConfig = {
  httpsPort: number;
  target: string;
  keyFile: string;
  certFile: string;
  caFile?: string;
};

function resolvePackageRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '..');
}

function resolveDefaultCertPath(filename: string): string {
  return path.join(resolvePackageRoot(), '.certs', filename);
}

function parsePort(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function derivePortFromTarget(target: string): number | undefined {
  try {
    const url = new URL(target);
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    return Number.isFinite(port) ? port : undefined;
  } catch {
    return undefined;
  }
}

function resolveProxyConfig(overrides: HttpsProxyOverrides = {}): HttpsProxyConfig {
  const envPort = parsePort(process.env.EXAMPLE_PROXY_HTTPS_PORT);
  const targetPort = parsePort(process.env.EXAMPLE_PROXY_TARGET_PORT) || parsePort(process.env.PORT) || 4122;
  const target = overrides.target || `http://localhost:${targetPort}`;
  const fallbackPort = targetPort + 1;
  const httpsPort = overrides.httpsPort || envPort || fallbackPort;

  const keyFile = overrides.keyFile || process.env.EXAMPLE_PROXY_KEY_FILE || resolveDefaultCertPath('localhost-key.pem');
  const certFile = overrides.certFile || process.env.EXAMPLE_PROXY_CERT_FILE || resolveDefaultCertPath('localhost.pem');
  const caFile = overrides.caFile || process.env.EXAMPLE_PROXY_CA_FILE;

  return { httpsPort, target, keyFile, certFile, caFile };
}

export function startHttpsProxy(overrides: HttpsProxyOverrides = {}): https.Server {
  const config = resolveProxyConfig(overrides);
  if (!fs.existsSync(config.keyFile) || !fs.existsSync(config.certFile)) {
    throw new Error(
      `[example-proxy] TLS certs not found. Expected key=${config.keyFile} cert=${config.certFile}. ` +
      `Generate with mkcert (see README) or set EXAMPLE_PROXY_KEY_FILE/EXAMPLE_PROXY_CERT_FILE.`
    );
  }

  const tlsOptions: https.ServerOptions = {
    key: fs.readFileSync(config.keyFile),
    cert: fs.readFileSync(config.certFile),
  };
  if (config.caFile) {
    tlsOptions.ca = fs.readFileSync(config.caFile);
  }

  const proxy = httpProxy.createProxyServer({
    target: config.target,
    changeOrigin: true,
    xfwd: true,
  });

  proxy.on('error', (error, _req, res) => {
    if (res && !res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Bad gateway: ${error.message}`);
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[example-proxy] proxy error', error);
  });

  const server = https.createServer(tlsOptions, (req, res) => {
    proxy.web(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head);
  });

  server.listen(config.httpsPort, () => {
    // eslint-disable-next-line no-console
    console.log(`[example-proxy] HTTPS -> ${config.target} listening on https://127.0.0.1:${config.httpsPort}`);
  });

  return server;
}
