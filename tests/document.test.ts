import { describe, expect, it } from 'vitest';
import { articleTitle, parseDocument, wordCount } from '../shared/document';

describe('Markdown documents', () => {
  it('reads CRLF front matter and preserves the body', () => {
    const parsed = parseDocument('\uFEFF---\r\ntitle: 一封信\r\nauthor: 作者\r\ndate: 2026-09-15\r\n---\r\n# 正文\r\n你好');
    expect(parsed.metadata).toEqual({ title: '一封信', author: '作者', date: '2026-09-15' });
    expect(parsed.body).toBe('# 正文\r\n你好');
  });
  it('keeps malformed front matter visible and uses the Markdown title', () => {
    const source = '---\ntitle: [broken\n---\n# 文章标题\n';
    expect(parseDocument(source).body).toBe(source);
    expect(articleTitle(source, 'fallback.md')).toBe('文章标题');
  });
  it('ignores non-scalar and unknown metadata', () => {
    expect(parseDocument('---\ntitle: [1, 2]\nauthor: 123\nscript: evil\n---\n正文').metadata).toEqual({ author: '123' });
  });
  it('counts Chinese characters and English words without metadata or URLs', () => {
    expect(wordCount('---\ntitle: 隐藏标题\n---\n# Hello 世界 and 123\n\n[你好](https://example.com/long-url)')).toBe(7);
  });
});
