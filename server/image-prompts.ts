import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultCoverPrompts, MAX_COVER_PROMPTS, MAX_PROMPT_CONTENT, MAX_PROMPT_NAME, type CoverPromptLibrary } from '../shared/image-prompts';
import { AppError } from './workspace';

function promptFields(input: unknown): { id?: string; name: string; content: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, '提示词格式不正确。');
  const { id, name, content } = input as Record<string, unknown>;
  if (id !== undefined && (typeof id !== 'string' || !id || id.length > 80 || /[\s\0]/.test(id))) throw new AppError(400, '提示词 ID 无效。');
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_PROMPT_NAME || /[\r\n\0]/.test(name)) throw new AppError(400, `提示词名称应为 1–${MAX_PROMPT_NAME} 个字符。`);
  if (typeof content !== 'string' || !content.trim() || content.length > MAX_PROMPT_CONTENT || content.includes('\0')) throw new AppError(400, `提示词内容应为 1–${MAX_PROMPT_CONTENT} 个字符。`);
  return { id: id as string | undefined, name: name.trim(), content: content.trim() };
}

export class CoverPromptStore {
  private state = defaultCoverPrompts();
  private queue: Promise<unknown> = Promise.resolve();
  private filename: string;
  constructor(storageDirectory: string) { this.filename = path.join(storageDirectory, 'image-prompts.json'); }

  async init() {
    try {
      const value = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (!Array.isArray(value?.prompts) || !value.prompts.length || value.prompts.length > MAX_COVER_PROMPTS) throw new Error('Invalid prompt library');
      const prompts = value.prompts.map((item: unknown) => {
        const prompt = promptFields(item);
        if (!prompt.id) throw new Error('Missing prompt ID');
        return { ...prompt, id: prompt.id };
      });
      if (new Set(prompts.map((item: { id: string }) => item.id)).size !== prompts.length || !prompts.some((item: { id: string }) => item.id === value.selectedId)) throw new Error('Invalid selection');
      this.state = { prompts, selectedId: value.selectedId };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError(500, '封面提示词无法读取，请检查 .mopai/image-prompts.json。');
    }
  }

  get library(): CoverPromptLibrary { return structuredClone(this.state); }

  private update(change: (current: CoverPromptLibrary) => CoverPromptLibrary): Promise<CoverPromptLibrary> {
    const next = this.queue.then(async () => {
      const library = change(this.library);
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(library, null, 2), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, this.filename);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      this.state = library;
      return this.library;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  save(input: unknown) {
    const prompt = promptFields(input);
    return this.update((library) => {
      if (prompt.id && !library.prompts.some((item) => item.id === prompt.id)) throw new AppError(404, '这个提示词不存在，请重新打开封面窗口。');
      if (library.prompts.some((item) => item.id !== prompt.id && item.name === prompt.name)) throw new AppError(409, '已有同名提示词，请使用不同的名称。');
      if (!prompt.id && library.prompts.length >= MAX_COVER_PROMPTS) throw new AppError(400, `最多保存 ${MAX_COVER_PROMPTS} 个提示词，请编辑已有提示词。`);
      const saved = { ...prompt, id: prompt.id || randomUUID() };
      const prompts = prompt.id ? library.prompts.map((item) => item.id === prompt.id ? saved : item) : [...library.prompts, saved];
      return { prompts, selectedId: saved.id };
    });
  }

  select(id: unknown) {
    return this.update((library) => {
      if (typeof id !== 'string' || !library.prompts.some((item) => item.id === id)) throw new AppError(404, '请选择一个已保存的提示词。');
      return { ...library, selectedId: id };
    });
  }
}
