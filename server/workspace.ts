import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { articleTitle } from '../shared/document';
import type { Article, ArticleSettings, ArticleSummary, DirectoryListing, Theme, Workspace } from '../shared/types';

export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR') { super(message); }
}

interface State { directory: string; settings: Record<string, ArticleSettings>; themes: Theme[] }
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const excluded = new Set(['node_modules', 'dist', 'build', 'vendor', '$RECYCLE.BIN', 'System Volume Information']);
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const revision = (content: string) => createHash('sha256').update(content).digest('hex');
const normalizePath = (value: string) => value.split(path.sep).join('/');

export class WorkspaceService {
  private state!: State;
  private stateQueue = Promise.resolve();
  private fileQueue = Promise.resolve();
  readonly projectDirectory: string;

  constructor(readonly storageDirectory: string, readonly initialDirectory: string, projectDirectory = process.cwd()) {
    this.projectDirectory = projectDirectory;
  }

  async init() {
    await fs.mkdir(this.storageDirectory, { recursive: true });
    await fs.mkdir(this.initialDirectory, { recursive: true });
    this.state = { directory: await fs.realpath(this.initialDirectory), settings: {}, themes: [] };
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.storageDirectory, 'state.json'), 'utf8')) as State;
      if (saved && typeof saved.directory === 'string') {
        try { saved.directory = await this.checkDirectory(saved.directory); }
        catch { saved.directory = this.state.directory; }
        this.state = { directory: saved.directory, settings: saved.settings || {}, themes: Array.isArray(saved.themes) ? saved.themes : [] };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError(500, '本地设置文件无法读取。请检查 .mopai/state.json 后重新启动。');
    }
  }

  get directory() { return this.state.directory; }
  get themes() { return this.state.themes; }

  private persist(change: () => void) {
    const next = this.stateQueue.then(async () => {
      const previous = structuredClone(this.state);
      change();
      const temporary = path.join(this.storageDirectory, `state-${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
        await fs.rename(temporary, path.join(this.storageDirectory, 'state.json'));
      } catch (error) {
        this.state = previous;
        await fs.unlink(temporary).catch(() => {});
        throw error;
      }
    });
    this.stateQueue = next.catch(() => {});
    return next;
  }

  private serializeFile<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.fileQueue.then(operation);
    this.fileQueue = next.then(() => {}, () => {});
    return next;
  }

  async checkDirectory(directory: string) {
    if (!directory.trim() || !path.isAbsolute(directory)) throw new AppError(400, '请输入完整的本地目录路径。');
    const target = await fs.realpath(directory);
    if (!(await fs.stat(target)).isDirectory()) throw new AppError(400, '请选择一个目录，而不是文件。');
    await fs.access(target, constants.R_OK);
    return target;
  }

  async setDirectory(directory: string) {
    const resolved = await this.checkDirectory(directory);
    await this.persist(() => { this.state.directory = resolved; });
    return this.list();
  }

  async resolveFile(relativePath: string, options: { creating?: boolean; markdown?: boolean; root?: string } = {}) {
    const { creating = false, markdown = true, root = this.directory } = options;
    if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) throw new AppError(400, '文件路径无效。');
    const target = path.resolve(root, relativePath);
    if (!inside(root, target) || target === root) throw new AppError(403, '文件必须位于当前文章目录中。');
    if (markdown && !/\.md$/i.test(target)) throw new AppError(400, '仅支持 .md 格式的文章。');
    const resolved = creating ? path.join(await fs.realpath(path.dirname(target)), path.basename(target)) : await fs.realpath(target);
    if (!inside(root, resolved)) throw new AppError(403, '不能访问文章目录外的链接文件。');
    if (!creating && !(await fs.stat(resolved)).isFile()) throw new AppError(400, '请选择一个有效文件。');
    return resolved;
  }

  async list(): Promise<Workspace> {
    const root = this.directory;
    const articles: ArticleSummary[] = [];
    const directories: string[] = [];
    let truncated = false;
    let visitedDirectories = 0;
    const walk = async (directory: string, depth: number) => {
      if (depth > 12 || visitedDirectories++ > 3000 || articles.length >= 2000) { truncated = true; return; }
      if (directory !== root) directories.push(normalizePath(path.relative(root, directory)));
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
        if (directory === root) throw error;
        return [];
      });
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(fullPath, depth + 1);
        else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          if (articles.length >= 2000) { truncated = true; break; }
          try {
            const info = await fs.stat(fullPath);
            if (info.size > MAX_FILE_SIZE) { truncated = true; continue; }
            const handle = await fs.open(fullPath, 'r');
            let content = '';
            try {
              const buffer = Buffer.alloc(Math.min(info.size, 8192));
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
              content = buffer.subarray(0, bytesRead).toString('utf8');
            } finally { await handle.close(); }
            articles.push({ path: normalizePath(path.relative(root, fullPath)), name: entry.name, title: articleTitle(content, entry.name), modifiedAt: info.mtime.toISOString(), size: info.size });
          } catch { /* A file may disappear while its directory is being scanned. */ }
        }
      }
    };
    await walk(root, 0);
    return { directory: root, name: path.basename(root) || root, directories, articles, truncated };
  }

  async read(relativePath: string, root = this.directory): Promise<Article> {
    const target = await this.resolveFile(relativePath, { root });
    const info = await fs.stat(target);
    if (info.size > MAX_FILE_SIZE) throw new AppError(413, '文章超过 2 MB，请拆分后再打开。');
    const content = await fs.readFile(target, 'utf8');
    return { path: normalizePath(path.relative(root, target)), name: path.basename(target), title: articleTitle(content, path.basename(target)), content, revision: revision(content), modifiedAt: info.mtime.toISOString(), size: info.size, settings: this.state.settings[`${root}\0${normalizePath(path.relative(root, target))}`] };
  }

  async save(relativePath: string, content: string, expectedRevision: string) {
    const root = this.directory;
    return this.serializeFile(async () => {
      const current = await this.read(relativePath, root);
      if (current.revision !== expectedRevision) throw new AppError(409, '这篇文章已被其他编辑器修改。你的内容仍保留在编辑区，请先下载当前草稿，再重新载入文件。', 'FILE_CONFLICT');
      if (Buffer.byteLength(content) > MAX_FILE_SIZE) throw new AppError(413, '文章不能超过 2 MB。');
      const target = await this.resolveFile(relativePath, { root });
      const temporary = path.join(path.dirname(target), `.mopai-${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, content, 'utf8');
        await fs.rename(temporary, target);
      } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
      return this.read(relativePath, root);
    });
  }

  async create(relativePath: string, content: string, unique = false) {
    const root = this.directory;
    return this.serializeFile(async () => {
      if (Buffer.byteLength(content) > MAX_FILE_SIZE) throw new AppError(413, '文章不能超过 2 MB。');
      if (relativePath.split(/[\\/]/).some((part) => /[:*?"<>|\u0000-\u001f]/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) throw new AppError(400, '文件名包含系统不支持的字符。');
      const original = relativePath;
      for (let suffix = 1; suffix < 1000; suffix++) {
        const target = await this.resolveFile(relativePath, { creating: true, root });
        try {
          await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
          return this.read(relativePath, root);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (!unique) throw new AppError(409, '已有同名文章，请换一个名称。');
          relativePath = original.replace(/\.md$/i, ` (${suffix}).md`);
        }
      }
      throw new AppError(409, '同名文件过多，请重命名后导入。');
    });
  }

  async saveSettings(relativePath: string, settings: ArticleSettings) {
    const root = this.directory;
    const target = await this.resolveFile(relativePath, { root });
    const key = `${root}\0${normalizePath(path.relative(root, target))}`;
    await this.persist(() => { this.state.settings[key] = settings; });
  }

  async addTheme(theme: Theme) {
    await this.persist(() => { this.state.themes = [...this.state.themes.filter((item) => item.id !== theme.id), theme]; });
    return theme;
  }

  async deleteTheme(id: string) {
    if (!this.state.themes.some((theme) => theme.id === id)) throw new AppError(404, '未找到这个自定义主题。');
    await this.persist(() => { this.state.themes = this.state.themes.filter((theme) => theme.id !== id); });
  }

  async directories(directory?: string): Promise<DirectoryListing> {
    const resolved = await this.checkDirectory(directory || this.directory);
    const children = await fs.readdir(resolved, { withFileTypes: true });
    return {
      path: resolved,
      parent: path.dirname(resolved) === resolved ? null : path.dirname(resolved),
      directories: children.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !excluded.has(entry.name)).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) })),
      bookmarks: [{ name: '文章目录', path: this.directory }, { name: '项目目录', path: this.projectDirectory }, { name: '用户目录', path: os.homedir() }],
    };
  }
}
