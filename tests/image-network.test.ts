import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageNetwork, imageProxy, parseWindowsProxy } from '../server/image-network';

afterEach(() => vi.unstubAllGlobals());

describe('image request proxy routing', () => {
  const system = { server: 'http=127.0.0.1:7890;https=127.0.0.1:7891', bypass: '<local>;*.internal.example;secure.example:443' };
  it('reads enabled Windows settings and ignores disabled or missing proxies', () => {
    const registry = '\r\n    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    127.0.0.1:7890\r\n    ProxyOverride    REG_SZ    <local>;*.internal\r\n';
    expect(parseWindowsProxy(registry)).toEqual({ server: '127.0.0.1:7890', bypass: '<local>;*.internal' });
    expect(parseWindowsProxy(registry.replace('0x1', '0x0'))).toBeUndefined();
    expect(parseWindowsProxy('')).toBeUndefined();
  });
  it('uses the system proxy for the target protocol and honors bypass patterns', () => {
    expect(imageProxy(new URL('https://images.example/file'), {}, system)).toBe('http://127.0.0.1:7891/');
    expect(imageProxy(new URL('http://images.example/file'), {}, system)).toBe('http://127.0.0.1:7890/');
    for (const address of ['https://printer', 'https://files.internal.example/file', 'https://secure.example']) {
      expect(imageProxy(new URL(address), {}, system)).toBeUndefined();
    }
    expect(imageProxy(new URL('https://secure.example:8443'), {}, system)).toBe('http://127.0.0.1:7891/');
    expect(imageProxy(new URL('https://images.example'), {})).toBeUndefined();
  });
  it('prioritizes proxy environment variables and respects NO_PROXY host boundaries and ports', () => {
    const env = { HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: '.direct.example,custom.example:8443' };
    expect(imageProxy(new URL('https://images.example'), env, system)).toBe('http://proxy.example:8080/');
    for (const address of ['https://direct.example', 'https://files.direct.example', 'https://custom.example:8443']) {
      expect(imageProxy(new URL(address), env, system)).toBeUndefined();
    }
    expect(imageProxy(new URL('https://notdirect.example'), env, system)).toBe('http://proxy.example:8080/');
    expect(imageProxy(new URL('https://custom.example'), env, system)).toBe('http://proxy.example:8080/');
    expect(imageProxy(new URL('https://images.example'), { ...env, no_proxy: '*' }, system)).toBeUndefined();
    expect(imageProxy(new URL('https://images.example'), { ALL_PROXY: 'http://proxy.example:8080' })).toBe('http://proxy.example:8080/');
  });
  it('always connects to local providers directly and redacts invalid proxy addresses', () => {
    for (const address of ['http://localhost:9000', 'http://127.0.0.1:9000', 'http://[::1]:9000']) {
      expect(imageProxy(new URL(address), { HTTPS_PROXY: 'http://proxy.example:8080', HTTP_PROXY: 'http://proxy.example:8080' }, system)).toBeUndefined();
    }
    let failure: unknown;
    try { imageProxy(new URL('https://images.example'), { HTTPS_PROXY: 'socks5://user:secret@proxy.example:1080' }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'IMAGE_PROXY_INVALID' });
    expect(String(failure)).not.toContain('secret');
  });
  it('routes fetch through a scoped reusable dispatcher while preserving auth, abort and redirect options', async () => {
    const network = new ImageNetwork(async () => system, {});
    const fetcher = vi.fn().mockImplementation(async () => new Response('image'));
    vi.stubGlobal('fetch', fetcher);
    const init = { signal: new AbortController().signal, redirect: 'manual' as const, headers: { Authorization: 'Bearer test-key' } };
    try {
      await network.fetch('https://images.example/image', init);
      await network.fetch('https://cdn.example/image', { ...init, headers: {} });
      await network.fetch('http://127.0.0.1:9000/image', init);
      expect(fetcher.mock.calls[0][1]).toMatchObject(init);
      const dispatcher = fetcher.mock.calls[0][1].dispatcher;
      expect(dispatcher.dispatch).toBeTypeOf('function');
      expect(fetcher.mock.calls[1][1].dispatcher).toBe(dispatcher);
      expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
      expect(fetcher.mock.calls[2][1]).not.toHaveProperty('dispatcher');
      expect(init).not.toHaveProperty('dispatcher');
    } finally { await network.close(); }
  });
  it('does not start a request when its deadline expires during proxy discovery', async () => {
    const controller = new AbortController();
    const network = new ImageNetwork(async () => { controller.abort(); return system; }, {});
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(network.fetch('https://images.example/image', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await network.close(); }
  });
});
