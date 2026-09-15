import { parse } from 'yaml';

export interface DocumentMetadata { title?: string; author?: string; date?: string; summary?: string; category?: string }

export function parseDocument(content: string): { metadata: DocumentMetadata; body: string } {
  const match = content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: content };
  try {
    const values = parse(match[1], { maxAliasCount: 20 });
    const metadata: DocumentMetadata = {};
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      for (const key of ['title', 'author', 'date', 'summary', 'category'] as const) {
        if (typeof values[key] === 'string' || typeof values[key] === 'number') metadata[key] = String(values[key]).slice(0, 500);
      }
    }
    return { metadata, body: content.replace(/^\uFEFF/, '').slice(match[0].length) };
  } catch { return { metadata: {}, body: content }; }
}

export function articleTitle(content: string, filename: string): string {
  const { metadata, body } = parseDocument(content);
  return metadata.title || body.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, '').trim() || filename.replace(/\.md$/i, '');
}

export function wordCount(content: string): number {
  const { body } = parseDocument(content);
  const plain = body.replace(/```[\s\S]*?```/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '');
  const chinese = plain.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length || 0;
  const words = plain.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0;
  return chinese + words;
}
