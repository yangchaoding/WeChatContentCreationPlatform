import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { builtInThemes, defaultSettings } from '../shared/themes';
import type { ArticleSettings, SemanticRole, Theme } from '../shared/types';
import { AppError, WorkspaceService } from './workspace';
import { extractTheme, fetchWeChatArticle, safeStyles } from './extract';
import fs from 'node:fs/promises';
import { compatiblePng, ImageService } from './images';
import { CoverPromptStore } from './image-prompts';

const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };
const textField = (value: unknown, name: string, max = 2048) => {
  if (typeof value !== 'string' || value.length > max) throw new AppError(400, `${name}格式不正确。`);
  return value;
};
const hex = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

function validateSettings(input: unknown, themes: Theme[]): ArticleSettings {
  if (!input || typeof input !== 'object') throw new AppError(400, '排版设置无效。');
  const settings = input as ArticleSettings;
  if (!themes.some((theme) => theme.id === settings.themeId)) throw new AppError(400, '请选择一个现有主题。');
  const result = defaultSettings();
  result.themeId = settings.themeId;
  for (const [key, min, max] of [['fontSize', 12, 22], ['lineHeight', 1.4, 2.5], ['paragraphSpacing', 8, 40]] as const) {
    if (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw new AppError(400, '字号、行距或段落间距超出支持范围。');
    result[key] = settings[key];
  }
  if (!hex(settings.accent) || !['sans', 'serif'].includes(settings.font)) throw new AppError(400, '字体或主题色无效。');
  result.accent = settings.accent;
  result.font = settings.font;
  for (const key of ['justify', 'showTitle', 'showMeta', 'linkFootnotes'] as const) result[key] = Boolean(settings[key]);
  return result;
}

function validateTheme(input: unknown): Theme {
  if (!input || typeof input !== 'object') throw new AppError(400, '主题无效。');
  const theme = input as Theme;
  if (!/^custom-[\da-f-]{36}$/i.test(theme.id || '') || !theme.name?.trim() || theme.name.length > 24) throw new AppError(400, '主题名称应为 1–24 个字符。');
  if (![theme.accent, theme.soft, theme.ink, theme.muted].every(hex)) throw new AppError(400, '主题色无效。');
  const settings = validateSettings({ ...defaultSettings(), ...theme, themeId: theme.id }, [theme]);
  const styles: Theme['styles'] = {};
  for (const role of ['body', 'h1', 'h2', 'h3', 'p', 'strong', 'blockquote', 'a', 'ul', 'ol', 'li', 'pre', 'code', 'hr', 'img', 'table', 'th', 'td'] as SemanticRole[]) {
    if (theme.styles?.[role]) styles[role] = safeStyles(theme.styles[role]);
  }
  return { ...builtInThemes[0], id: theme.id, name: theme.name.trim(), description: '从文章中提取的自定义主题', category: '我的', custom: true, accent: theme.accent, soft: theme.soft, ink: theme.ink, muted: theme.muted, font: settings.font, headingFont: theme.headingFont === 'serif' ? 'serif' : 'sans', fontSize: settings.fontSize, lineHeight: settings.lineHeight, paragraphSpacing: settings.paragraphSpacing, headingStyle: ['bar', 'underline', 'centered', 'minimal', 'pill'].includes(theme.headingStyle) ? theme.headingStyle : 'minimal', quoteStyle: ['line', 'card', 'plain'].includes(theme.quoteStyle) ? theme.quoteStyle : 'line', codeStyle: theme.codeStyle === 'dark' || theme.codeStyle === 'warm' ? theme.codeStyle : 'light', sourceUrl: typeof theme.sourceUrl === 'string' && /^https:\/\/mp\.weixin\.qq\.com\/s/.test(theme.sourceUrl) ? theme.sourceUrl.slice(0, 4096) : undefined, sourceTitle: typeof theme.sourceTitle === 'string' ? theme.sourceTitle.slice(0, 200) : undefined, createdAt: new Date().toISOString(), styles };
}

export async function createLocalApp(options: { storageDirectory: string; initialDirectory: string; projectDirectory?: string; watch?: boolean; distDirectory?: string }) {
  const service = new WorkspaceService(options.storageDirectory, options.initialDirectory, options.projectDirectory);
  await service.init();
  const images = new ImageService(service);
  await images.init();
  const imagePrompts = new CoverPromptStore(options.storageDirectory);
  await imagePrompts.init();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const allowedHosts = ['127.0.0.1', 'localhost', '[::1]', '::1'];
    if (!allowedHosts.includes(req.hostname)) return res.status(403).json({ message: '墨排仅接受本机访问。' });
    const origin = req.get('origin');
    if (origin) {
      try { if (!allowedHosts.includes(new URL(origin).hostname)) return res.status(403).json({ message: '不允许来自其他网站的请求。' }); }
      catch { return res.status(403).json({ message: '请求来源无效。' }); }
    }
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ message: '不允许跨站访问本地文章。' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', express.json({ limit: '6mb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const clients = new Set<Response>();
  let watcher: FSWatcher | undefined;
  let watching = false;
  let timer: NodeJS.Timeout | undefined;
  const broadcast = (event: string, detail = {}) => { for (const client of clients) client.write(`data: ${JSON.stringify({ type: event, ...detail })}\n\n`); };
  const watchDirectory = async () => {
    await watcher?.close();
    watcher = undefined; watching = false;
    clearTimeout(timer);
    broadcast('watch-status', { watching });
    if (!options.watch) return;
    const watchedRoot = service.directory;
    let watchFailed = false;
    const nextWatcher = chokidar.watch(watchedRoot, { ignoreInitial: true, depth: 12, ignored: (filePath) => path.relative(watchedRoot, filePath).split(/[/\\]/).some((segment) => segment.startsWith('.') || ['node_modules', 'dist', 'build'].includes(segment)), awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 } });
    watcher = nextWatcher;
    watcher.on('ready', () => {
      if (watcher !== nextWatcher) return;
      watching = !watchFailed; broadcast('watch-status', { watching });
    });
    watcher.on('all', (event, filePath) => {
      if (watcher !== nextWatcher) return;
      if (event !== 'addDir' && event !== 'unlinkDir' && !/\.md$/i.test(filePath)) return;
      clearTimeout(timer);
      timer = setTimeout(() => broadcast('files-changed'), 250);
    });
    watcher.on('error', () => {
      if (watcher !== nextWatcher) return;
      watchFailed = true; watching = false; broadcast('watch-error');
    });
  };
  await watchDirectory();
  const checkScope = (req: Request) => {
    const directory = req.query.directory || req.body?.directory;
    if (directory && directory !== service.directory) throw new AppError(409, '文章目录已在另一个窗口切换，请刷新工作空间。', 'WORKSPACE_CHANGED');
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.0.0' }));
  app.get('/api/workspace', asyncRoute(async (_req, res) => res.json(await service.list())));
  app.post('/api/workspace', asyncRoute(async (req, res) => {
    const workspace = await service.setDirectory(textField(req.body?.directory, '目录路径'));
    await watchDirectory();
    broadcast('workspace-changed');
    res.json(workspace);
  }));
  app.get('/api/directories', asyncRoute(async (req, res) => res.json(await service.directories(typeof req.query.path === 'string' ? req.query.path : undefined))));
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'watch-status', watching })}\n\n`);
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
    req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
  });

  app.get('/api/article', asyncRoute(async (req, res) => { checkScope(req); res.json(await service.read(textField(req.query.path, '文章路径'))); }));
  app.put('/api/article', asyncRoute(async (req, res) => {
    checkScope(req);
    res.json(await service.save(textField(req.body?.path, '文章路径'), textField(req.body?.content, '文章内容', 2 * 1024 * 1024), textField(req.body?.revision, '文件版本', 100)));
  }));
  app.post('/api/articles', asyncRoute(async (req, res) => {
    checkScope(req);
    res.status(201).json(await service.create(textField(req.body?.path, '文章路径'), textField(req.body?.content, '文章内容', 2 * 1024 * 1024)));
  }));
  app.post('/api/articles/import', asyncRoute(async (req, res) => {
    checkScope(req);
    if (!Array.isArray(req.body?.files) || !req.body.files.length || req.body.files.length > 30) throw new AppError(400, '每次可以导入 1–30 篇 Markdown 文章。');
    const files = req.body.files.map((file: { name: unknown; content: unknown }) => ({ name: textField(file.name, '文件名', 200), content: textField(file.content, '文章内容', 2 * 1024 * 1024) }));
    if (files.some((file: { name: string }) => /[/\\]/.test(file.name) || !/\.md$/i.test(file.name))) throw new AppError(400, '请选择 .md 文件。');
    const imported = [];
    for (const file of files) imported.push(await service.create(file.name, file.content, true));
    res.status(201).json({ articles: imported });
  }));
  app.put('/api/article-settings', asyncRoute(async (req, res) => {
    checkScope(req);
    const settings = validateSettings(req.body?.settings, [...builtInThemes, ...service.themes]);
    await service.saveSettings(textField(req.body?.path, '文章路径'), settings);
    res.json({ ok: true });
  }));
  app.get('/api/assets', asyncRoute(async (req, res) => {
    checkScope(req);
    const target = await service.resolveFile(textField(req.query.path, '图片路径'), { markdown: false });
    if (!/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(target)) throw new AppError(400, '仅支持常见图片格式。');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (req.query.format === 'png') {
      if ((await fs.stat(target)).size > 20 * 1024 * 1024) throw new AppError(413, '图片超过 20 MB，无法复制。');
      const png = await compatiblePng(await fs.readFile(target));
      if (req.query.download === '1') res.attachment(`${path.basename(target, path.extname(target))}.png`);
      return res.type('png').send(png.data);
    }
    res.sendFile(target);
  }));
  app.get('/api/image-settings', (_req, res) => res.json(images.publicSettings));
  app.put('/api/image-settings', asyncRoute(async (req, res) => res.json(await images.saveSettings(req.body))));
  app.get('/api/image-prompts', (_req, res) => res.json(imagePrompts.library));
  app.post('/api/image-prompts', asyncRoute(async (req, res) => res.json(await imagePrompts.save(req.body))));
  app.put('/api/image-prompts/selection', asyncRoute(async (req, res) => res.json(await imagePrompts.select(req.body?.id))));
  app.get('/api/images/models', asyncRoute(async (_req, res) => res.json(await images.listModels())));
  app.post('/api/images/models', asyncRoute(async (req, res) => res.json(await images.listModels(req.body))));
  app.post('/api/images/generate', asyncRoute(async (req, res) => {
    checkScope(req);
    res.json(await images.generate({
      requestId: textField(req.body?.requestId, '生成请求标识', 50),
      directory: textField(req.body?.directory, '文章目录'),
      articlePath: textField(req.body?.articlePath, '文章路径'),
      content: textField(req.body?.content, '文章内容', 2 * 1024 * 1024),
      style: textField(req.body?.style ?? '', '画面要求', 2000),
    }));
  }));
  app.get('/api/themes', (_req, res) => res.json(service.themeLibrary));
  app.put('/api/themes/default', asyncRoute(async (req, res) => {
    await service.setDefaultTheme(textField(req.body?.themeId, '主题 ID', 100));
    res.json(service.themeLibrary);
    broadcast('themes-changed');
  }));
  app.post('/api/themes/extract', asyncRoute(async (req, res) => {
    if (typeof req.body?.html === 'string') return res.json({ theme: extractTheme(req.body.html) });
    const article = await fetchWeChatArticle(textField(req.body?.url, '公众号链接', 4096));
    res.json({ theme: extractTheme(article.html, article.url) });
  }));
  app.post('/api/themes', asyncRoute(async (req, res) => {
    res.status(201).json({ theme: await service.addTheme(validateTheme(req.body?.theme)) });
    broadcast('themes-changed');
  }));
  app.delete('/api/themes/:id', asyncRoute(async (req, res) => {
    await service.deleteTheme(textField(req.params.id, '主题 ID', 100));
    res.json({ ok: true, ...service.themeLibrary });
    broadcast('themes-changed');
  }));
  app.use('/api', (_req, res) => res.status(404).json({ message: '未找到这个接口。' }));
  if (options.distDirectory) {
    app.use(express.static(options.distDirectory));
    app.get('*', (_req, res) => res.sendFile(path.join(options.distDirectory!, 'index.html')));
  }
  app.use((error: Error & { code?: string; status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const fileErrors: Record<string, [number, string]> = { ENOENT: [404, '目录或文件不存在，请检查路径。'], EACCES: [403, '没有读写权限，请选择有权限的目录。'], EPERM: [403, '文件被占用或没有写入权限，请关闭占用程序后重试。'], ENOTDIR: [400, '路径不是一个目录。'], EBUSY: [423, '文件正在被其他程序占用，请稍后重试。'] };
    const mapped = fileErrors[error.code || ''];
    const status = error instanceof AppError ? error.status : mapped?.[0] || (error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500);
    const message = error instanceof AppError ? error.message : mapped?.[1] || (status === 413 ? '导入内容过大，请分批导入。' : status === 400 ? '请求内容不是有效的 JSON。' : '本地服务遇到问题，请重试并检查终端日志。');
    if (status === 500) console.error(error);
    if (!res.headersSent) res.status(status).json({ message, code: error.code || 'ERROR' });
  });
  return { app, service, close: async () => { clearTimeout(timer); for (const client of clients) client.end(); await watcher?.close(); await images.close(); } };
}
