import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

type Pane = 'editor' | 'preview';
type View = 'edit' | 'preview' | 'split';

export function useSynchronizedScroll({ editorRef, previewRef, view, articleKey, revision }: {
  editorRef: RefObject<HTMLTextAreaElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  view: View;
  articleKey: string;
  revision: string;
}) {
  const position = useRef({ articleKey, progress: 0, leader: 'preview' as Pane });
  const refresh = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const panes = { editor: editorRef.current, preview: previewRef.current };
    const sides = ['editor', 'preview'] as const;
    const expected = new Map<Pane, number>();
    const lastTop = new Map<Pane, number>();
    let frame: number | null = null;
    if (position.current.articleKey !== articleKey) position.current = { articleKey, progress: 0, leader: 'preview' };
    if (!panes[position.current.leader]) position.current.leader = panes.editor ? 'editor' : 'preview';

    const readProgress = (pane: HTMLElement) => {
      const range = pane.scrollHeight - pane.clientHeight;
      return range > 0 ? Math.max(0, Math.min(1, pane.scrollTop / range)) : position.current.progress;
    };
    const writePosition = (side: Pane) => {
      const pane = panes[side];
      if (!pane) return;
      const top = position.current.progress * Math.max(0, pane.scrollHeight - pane.clientHeight);
      if (Math.abs(pane.scrollTop - top) < 0.5) return;
      // The preview normally scrolls smoothly. A follower must move immediately
      // so its intermediate animation events cannot drive the other pane back.
      const behavior = pane.style.scrollBehavior;
      pane.style.scrollBehavior = 'auto';
      pane.scrollTop = top;
      pane.style.scrollBehavior = behavior;
      expected.set(side, pane.scrollTop);
    };
    const scheduleSync = () => {
      if (view !== 'split' || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const leader = panes[position.current.leader];
        if (leader) position.current.progress = readProgress(leader);
        writePosition(position.current.leader === 'editor' ? 'preview' : 'editor');
      });
    };
    const onScroll = (side: Pane) => {
      const pane = panes[side];
      if (!pane) return;
      const top = pane.scrollTop;
      const previous = lastTop.get(side);
      lastTop.set(side, top);
      const pending = expected.get(side);
      expected.delete(side);
      if (pending !== undefined && Math.abs(top - pending) < 1) return;
      // Ignore horizontal scrolling, including wide code diagrams.
      if (previous !== undefined && Math.abs(top - previous) < 0.5) return;
      if (pane.scrollHeight <= pane.clientHeight) return;
      position.current.progress = readProgress(pane);
      position.current.leader = side;
      scheduleSync();
    };
    const onEditorScroll = () => onScroll('editor');
    const onPreviewScroll = () => onScroll('preview');
    for (const side of sides) {
      writePosition(side);
      lastTop.set(side, panes[side]?.scrollTop || 0);
    }
    panes.editor?.addEventListener('scroll', onEditorScroll, { passive: true });
    panes.preview?.addEventListener('scroll', onPreviewScroll, { passive: true });

    const observer = new ResizeObserver(scheduleSync);
    if (view === 'split') {
      if (panes.editor) observer.observe(panes.editor);
      if (panes.preview) {
        observer.observe(panes.preview);
        // Paper height changes after images load or typography/width changes.
        if (panes.preview.firstElementChild) observer.observe(panes.preview.firstElementChild);
      }
    }
    refresh.current = scheduleSync;
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      panes.editor?.removeEventListener('scroll', onEditorScroll);
      panes.preview?.removeEventListener('scroll', onPreviewScroll);
      refresh.current = null;
    };
  }, [editorRef, previewRef, view, articleKey]);

  useLayoutEffect(() => { refresh.current?.(); }, [revision]);
}
