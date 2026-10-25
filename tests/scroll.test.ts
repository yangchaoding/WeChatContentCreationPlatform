// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSynchronizedScroll } from '../src/hooks/useSynchronizedScroll';

describe('split view scroll synchronization', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let resize: () => void;
  let editorHeight: number;
  let previewHeight: number;
  let view: 'edit' | 'preview' | 'split';
  let articleKey: string;
  let revision: string;

  function Workbench() {
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    useSynchronizedScroll({ editorRef, previewRef, view, articleKey, revision });
    return createElement('main', null,
      view !== 'preview' && createElement('textarea', { ref: editorRef, 'data-pane': 'editor' }),
      view !== 'edit' && createElement('div', { ref: previewRef, 'data-pane': 'preview', style: { scrollBehavior: 'smooth' } }, createElement('article')),
    );
  }
  const render = () => act(() => root.render(createElement(Workbench)));
  const editor = () => host.querySelector('textarea')!;
  const preview = () => host.querySelector<HTMLDivElement>('[data-pane="preview"]')!;
  const flush = () => act(() => { vi.runOnlyPendingTimers(); });
  const scroll = (pane: HTMLElement, top: number) => {
    act(() => { pane.scrollTop = top; pane.dispatchEvent(new Event('scroll')); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    editorHeight = 1500;
    previewHeight = 2500;
    view = 'split';
    articleKey = 'article-1';
    revision = 'initial';
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.pane === 'editor' ? editorHeight : previewHeight;
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    render();
    flush();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('follows either pane by its scrollable range and reaches both ends', () => {
    scroll(editor(), 250);
    flush();
    expect(preview().scrollTop).toBe(500);
    expect(preview().style.scrollBehavior).toBe('smooth');
    scroll(preview(), 1500);
    flush();
    expect(editor().scrollTop).toBe(750);
    scroll(editor(), 1000);
    flush();
    expect(preview().scrollTop).toBe(2000);
    scroll(preview(), 0);
    flush();
    expect(editor().scrollTop).toBe(0);
  });

  it('ignores feedback events and batches rapid user scrolling', () => {
    scroll(editor(), 123);
    scroll(editor(), 400);
    expect(preview().scrollTop).toBe(0);
    flush();
    expect(preview().scrollTop).toBe(800);
    scroll(preview(), 800);
    expect(vi.getTimerCount()).toBe(0);
    expect(editor().scrollTop).toBe(400);
    // A real scroll on the follower takes control immediately.
    scroll(preview(), 600);
    flush();
    expect(editor().scrollTop).toBe(300);
  });

  it('does not synchronize horizontal scrolling or nested code block scrolling', () => {
    scroll(editor(), 300);
    flush();
    scroll(preview(), 600);
    preview().scrollLeft = 100;
    scroll(preview(), 600);
    const code = document.createElement('pre');
    preview().append(code);
    code.dispatchEvent(new Event('scroll'));
    expect(vi.getTimerCount()).toBe(0);
    expect(editor().scrollTop).toBe(300);
  });

  it('joins the current position when switching from either single pane to split view', () => {
    view = 'preview';
    render();
    scroll(preview(), 1400);
    view = 'split';
    render();
    expect(editor().scrollTop).toBe(700);
    view = 'edit';
    render();
    scroll(editor(), 200);
    view = 'split';
    render();
    expect(preview().scrollTop).toBe(400);
  });

  it('starts a different article at the top and cancels pending work', () => {
    scroll(editor(), 500);
    articleKey = 'article-2';
    render();
    flush();
    expect(editor().scrollTop).toBe(0);
    expect(preview().scrollTop).toBe(0);
  });

  it('recalculates after preview reflow, image load or content edits', () => {
    scroll(editor(), 500);
    flush();
    previewHeight = 4500;
    resize();
    flush();
    expect(preview().scrollTop).toBe(2000);
    editorHeight = 2500;
    revision = 'edited';
    render();
    flush();
    expect(preview().scrollTop).toBe(1000);
  });

  it('handles short documents and clamps positions to the available range', () => {
    previewHeight = 400;
    scroll(editor(), 500);
    flush();
    expect(preview().scrollTop).toBe(0);
    scroll(preview(), 0);
    expect(editor().scrollTop).toBe(500);
    previewHeight = 2500;
    scroll(editor(), -50);
    flush();
    expect(preview().scrollTop).toBe(0);
    scroll(editor(), 1200);
    flush();
    expect(preview().scrollTop).toBe(2000);
  });

  it('removes listeners and scheduled work when leaving split view', () => {
    const detachedEditor = editor();
    scroll(detachedEditor, 200);
    view = 'preview';
    render();
    const top = preview().scrollTop;
    scroll(detachedEditor, 900);
    flush();
    expect(preview().scrollTop).toBe(top);
    expect(vi.getTimerCount()).toBe(0);
  });
});
