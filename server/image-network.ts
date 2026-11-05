import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProxyAgent } from 'undici';

interface SystemProxy { server: string; bypass: string }
const execute = promisify(execFile);
let systemCache: { expires: number; value: Promise<SystemProxy | undefined> } | undefined;

export function parseWindowsProxy(output: string): SystemProxy | undefined {
  const values = new Map([...output.matchAll(/^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.+)$/gm)].map((match) => [match[1], match[2].trim()]));
  if (Number(values.get('ProxyEnable')) !== 1 || !values.get('ProxyServer')) return undefined;
  return { server: values.get('ProxyServer')!, bypass: values.get('ProxyOverride') || '' };
}

async function readSystemProxy(): Promise<SystemProxy | undefined> {
  if (process.platform !== 'win32') return undefined;
  if (!systemCache || systemCache.expires <= Date.now()) {
    systemCache = {
      expires: Date.now() + 15_000,
      value: execute('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { windowsHide: true, timeout: 1500, maxBuffer: 64 * 1024 })
        .then(({ stdout }) => parseWindowsProxy(stdout)).catch(() => undefined),
    };
  }
  return systemCache.value;
}

function bypasses(url: URL, list: string, windows = false): boolean {
  return list.toLowerCase().split(/[;,\s]+/).filter(Boolean).some((entry) => {
    if (entry === '<local>') return !url.hostname.includes('.') && !url.hostname.includes(':');
    const protocol = entry.match(/^(https?):\/\//);
    if (protocol) {
      if (url.protocol !== `${protocol[1]}:`) return false;
      entry = entry.slice(protocol[0].length);
    }
    const port = entry.match(/:(\d+)$/);
    if (port) {
      if (port[1] !== (url.port || (url.protocol === 'https:' ? '443' : '80'))) return false;
      entry = entry.slice(0, -port[0].length);
    }
    if (!windows && !entry.includes('*')) {
      const host = entry.replace(/^\./, '');
      return url.hostname === host || url.hostname.endsWith(`.${host}`);
    }
    const pattern = entry.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}$`).test(url.hostname);
  });
}

export function imageProxy(url: URL, env: NodeJS.ProcessEnv, system?: SystemProxy): string | undefined {
  // Local providers must remain reachable even with a system-wide proxy enabled.
  if (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\./.test(url.hostname)) return undefined;
  if (bypasses(url, env.no_proxy || env.NO_PROXY || '')) return undefined;
  const explicit = url.protocol === 'https:' ? env.https_proxy || env.HTTPS_PROXY : env.http_proxy || env.HTTP_PROXY;
  let address = explicit || env.all_proxy || env.ALL_PROXY;
  if (!address && system && !bypasses(url, system.bypass, true)) {
    if (system.server.includes('=')) {
      const entries = system.server.split(';').map((part) => part.trim());
      address = entries.find((part) => part.toLowerCase().startsWith(`${url.protocol.slice(0, -1)}=`))?.split('=').slice(1).join('=');
    } else address = system.server;
  }
  if (!address) return undefined;
  try {
    const proxy = new URL(address.includes('://') ? address : `http://${address}`);
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.search || proxy.hash || proxy.pathname !== '/') throw new Error();
    return proxy.href;
  } catch {
    // Proxy URLs can contain passwords; never include them in diagnostics.
    throw Object.assign(new Error('Invalid image proxy'), { code: 'IMAGE_PROXY_INVALID' });
  }
}

export class ImageNetwork {
  private agents = new Map<string, ProxyAgent>();
  constructor(private readProxy = readSystemProxy, private env: NodeJS.ProcessEnv = process.env) {}

  async fetch(input: string | URL, init: RequestInit): Promise<Response> {
    const url = new URL(input);
    const proxy = imageProxy(url, this.env, await this.readProxy());
    init.signal?.throwIfAborted();
    if (!proxy) return fetch(input, init);
    let dispatcher = this.agents.get(proxy);
    if (!dispatcher) {
      dispatcher = new ProxyAgent(proxy);
      this.agents.set(proxy, dispatcher);
    }
    // Scope the dispatcher to image requests; keep TLS verification and redirect rules intact.
    return fetch(input, { ...init, ...{ dispatcher } });
  }

  async close() {
    await Promise.all([...this.agents.values()].map((agent) => agent.destroy()));
    this.agents.clear();
  }
}
