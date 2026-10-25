import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalApp } from '../server/app';
import { builtInThemes, defaultSettings, systemDefaultTheme } from '../shared/themes';

let temporary: string;
let articles: string;
let instance: Awaited<ReturnType<typeof createLocalApp>>;

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mopai-test-'));
  articles = path.join(temporary, 'articles');
  await fs.mkdir(path.join(articles, 'notes'), { recursive: true });
  await fs.mkdir(path.join(articles, '.hidden'));
  await fs.writeFile(path.join(articles, 'article.md'), '# Original title\n\nOriginal content\n');
  await fs.writeFile(path.join(articles, 'notes', 'nested.md'), '---\ntitle: 嵌套文章\n---\n# 内容');
  await fs.writeFile(path.join(articles, '.hidden', 'ignored.md'), '# Hidden');
  await fs.writeFile(path.join(articles, 'ignored.txt'), 'Not Markdown');
  instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles, projectDirectory: temporary });
});

afterEach(async () => {
  await instance?.close();
  // Only remove the uniquely named test workspace that this test created.
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mopai-test-')) throw new Error('Unexpected test cleanup path');
  await fs.rm(resolved, { recursive: true, force: true });
});

describe('Local workspace API', () => {
  it('scans nested Markdown articles and excludes hidden and non-Markdown files', async () => {
    const response = await request(instance.app).get('/api/workspace').expect(200);
    expect(response.body.articles.map((article: { path: string }) => article.path).sort()).toEqual(['article.md', 'notes/nested.md']);
    expect(response.body.articles.find((article: { path: string }) => article.path === 'notes/nested.md').title).toBe('嵌套文章');
    expect(response.body.directories).toEqual(['notes']);
    expect(response.body.truncated).toBe(false);
  });
  it('reads, saves and detects stale revisions without overwriting external edits', async () => {
    const original = (await request(instance.app).get('/api/article').query({ path: 'article.md' }).expect(200)).body;
    const saved = (await request(instance.app).put('/api/article').send({ path: 'article.md', content: '# New title\n\nA new draft', revision: original.revision }).expect(200)).body;
    expect(saved.revision).not.toBe(original.revision);
    expect(await fs.readFile(path.join(articles, 'article.md'), 'utf8')).toContain('A new draft');
    await fs.writeFile(path.join(articles, 'article.md'), '# Changed externally');
    const conflict = await request(instance.app).put('/api/article').send({ path: 'article.md', content: '# Stale draft', revision: saved.revision }).expect(409);
    expect(conflict.body.code).toBe('FILE_CONFLICT');
    expect(await fs.readFile(path.join(articles, 'article.md'), 'utf8')).toBe('# Changed externally');
  });
  it('serializes concurrent saves so only one stale revision can win', async () => {
    const original = await instance.service.read('article.md');
    const responses = await Promise.all(['First', 'Second'].map((content) => request(instance.app).put('/api/article').send({ path: 'article.md', content, revision: original.revision })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });
  it('creates articles without overwriting and imports duplicate filenames safely', async () => {
    await request(instance.app).post('/api/articles').send({ path: 'new.md', content: '# New' }).expect(201);
    await request(instance.app).post('/api/articles').send({ path: 'new.md', content: '# Replace' }).expect(409);
    const imported = await request(instance.app).post('/api/articles/import').send({ files: [{ name: 'new.md', content: '# Imported' }, { name: 'new.md', content: '# Imported again' }] }).expect(201);
    expect(imported.body.articles.map((article: { name: string }) => article.name)).toEqual(['new (1).md', 'new (2).md']);
    expect(await fs.readFile(path.join(articles, 'new.md'), 'utf8')).toBe('# New');
  });
  it('persists per-article theme settings across server restarts', async () => {
    const settings = { ...defaultSettings(builtInThemes.find((theme) => theme.id === 'sunset')), fontSize: 18, showMeta: false };
    await request(instance.app).put('/api/article-settings').send({ path: 'article.md', settings }).expect(200);
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    expect((await instance.service.read('article.md')).settings).toEqual(settings);
    expect((await instance.service.read('notes/nested.md')).settings).toBeUndefined();
  });
  it('persists the chosen default across restarts and workspace changes without rewriting article settings', async () => {
    const settings = { ...defaultSettings(builtInThemes.find((theme) => theme.id === 'sunset')), fontSize: 18 };
    await instance.service.saveSettings('article.md', settings);
    const response = await request(instance.app).put('/api/themes/default').send({ themeId: 'claude' }).expect(200);
    expect(response.body.defaultThemeId).toBe('claude');
    expect((await instance.service.read('article.md')).settings).toEqual(settings);
    expect((await instance.service.read('notes/nested.md')).settings).toBeUndefined();
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    expect((await request(instance.app).get('/api/themes')).body.defaultThemeId).toBe('claude');
    await request(instance.app).post('/api/workspace').send({ directory: path.join(articles, 'notes') }).expect(200);
    expect((await request(instance.app).get('/api/themes')).body.defaultThemeId).toBe('claude');
  });
  it('supports a custom default and restores the system default when that theme is deleted', async () => {
    const theme = { ...builtInThemes[1], id: 'custom-11111111-1111-4111-8111-111111111111', name: '默认自定义主题' };
    await request(instance.app).post('/api/themes').send({ theme }).expect(201);
    await request(instance.app).put('/api/themes/default').send({ themeId: theme.id }).expect(200);
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    expect(instance.service.themeLibrary.defaultThemeId).toBe(theme.id);
    const deleted = await request(instance.app).delete(`/api/themes/${theme.id}`).expect(200);
    expect(deleted.body.defaultThemeId).toBe(systemDefaultTheme.id);
    expect(deleted.body.themes.some((item: { id: string }) => item.id === theme.id)).toBe(false);
    const saved = JSON.parse(await fs.readFile(path.join(temporary, 'state', 'state.json'), 'utf8'));
    expect(saved.defaultThemeId).toBe(systemDefaultTheme.id);
  });
  it('rejects invalid default themes without losing the saved choice', async () => {
    await request(instance.app).put('/api/themes/default').send({ themeId: 'programming' }).expect(200);
    await request(instance.app).put('/api/themes/default').send({ themeId: 'missing' }).expect(404);
    await request(instance.app).put('/api/themes/default').send({ themeId: 123 }).expect(400);
    expect(instance.service.themeLibrary.defaultThemeId).toBe('programming');
    await request(instance.app).put('/api/themes/default').send({ themeId: 'claude' }).expect(200);
    expect(instance.service.themeLibrary.defaultThemeId).toBe('claude');
  });
  it.each([undefined, 'removed-theme'])('loads older or stale default-theme preferences (%s)', async (defaultThemeId) => {
    await instance.close();
    await fs.writeFile(path.join(temporary, 'state', 'state.json'), JSON.stringify({ directory: articles, themes: [], settings: {}, defaultThemeId }));
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    expect(instance.service.themeLibrary.defaultThemeId).toBe(systemDefaultTheme.id);
  });
  it('changes directories and rejects an in-flight request from the previous workspace', async () => {
    const second = path.join(temporary, 'second');
    await fs.mkdir(second);
    await fs.writeFile(path.join(second, 'article.md'), '# Another article');
    const original = await instance.service.read('article.md');
    await request(instance.app).post('/api/workspace').send({ directory: second }).expect(200);
    await request(instance.app).put('/api/article').send({ path: 'article.md', directory: articles, content: '# Wrong workspace', revision: original.revision }).expect(409);
    expect(await fs.readFile(path.join(second, 'article.md'), 'utf8')).toBe('# Another article');
  });
  it('returns a usable directory browser listing', async () => {
    const response = await request(instance.app).get('/api/directories').query({ path: articles }).expect(200);
    expect(response.body.directories).toEqual([{ name: 'notes', path: path.join(articles, 'notes') }]);
    expect(response.body.parent).toBe(temporary);
    expect(response.body.bookmarks).toHaveLength(3);
  });
  it('navigates multiple Chinese directory levels and reads articles in sibling folders', async () => {
    const course = path.join(articles, 'AI Agent开发');
    const phases = ['阶段一：Python编程基础', '阶段二：计算机与开发工具基础'];
    for (const phase of phases) {
      await fs.mkdir(path.join(course, phase, '练习'), { recursive: true });
      await fs.writeFile(path.join(course, phase, '练习', '同名.md'), `# ${phase}`);
    }
    const listing = await request(instance.app).get('/api/directories').query({ path: course }).expect(200);
    expect(listing.body.directories.map((child: { name: string }) => child.name).sort()).toEqual([...phases].sort());
    for (const phase of phases) {
      const directory = path.join(course, phase);
      const children = await request(instance.app).get('/api/directories').query({ path: directory }).expect(200);
      expect(children.body.parent).toBe(course);
      expect(children.body.directories).toEqual([{ name: '练习', path: path.join(directory, '练习') }]);
      const relativePath = `AI Agent开发/${phase}/练习/同名.md`;
      const article = await request(instance.app).get('/api/article').query({ path: relativePath }).expect(200);
      expect(article.body.path).toBe(relativePath);
      expect(article.body.content).toBe(`# ${phase}`);
      const switched = await request(instance.app).post('/api/workspace').send({ directory }).expect(200);
      expect(switched.body.articles.map((item: { path: string }) => item.path)).toEqual(['练习/同名.md']);
      await request(instance.app).post('/api/workspace').send({ directory: articles }).expect(200);
    }
  });
  it('includes empty directories and directories containing only Word documents', async () => {
    const emptyPath = 'AI Agent开发/阶段四：机器学习/待整理';
    const wordPath = 'AI Agent开发/阶段五：大语言模型';
    await fs.mkdir(path.join(articles, emptyPath), { recursive: true });
    await fs.mkdir(path.join(articles, wordPath), { recursive: true });
    await fs.writeFile(path.join(articles, wordPath, '概念.md.docx'), 'Word document placeholder');
    const response = await request(instance.app).get('/api/workspace').expect(200);
    expect(response.body.directories).toEqual(expect.arrayContaining(['AI Agent开发', 'AI Agent开发/阶段四：机器学习', emptyPath, wordPath]));
    expect(response.body.directories).not.toContain('.hidden');
    expect(response.body.articles).toHaveLength(2);
    const switched = await request(instance.app).post('/api/workspace').send({ directory: path.join(articles, 'AI Agent开发') }).expect(200);
    expect(switched.body.articles).toEqual([]);
    expect(switched.body.directories).toContain('阶段四：机器学习/待整理');
  });
  it.each(['dark', 'warm'] as const)('extracts, stores, reloads and removes a custom theme with %s code', async (codeStyle) => {
    const response = await request(instance.app).post('/api/themes/extract').send({ html: '<article style="font-size:16px;color:#444"><h2 style="color:#8a70a8">这是一篇文章</h2><p>正文里的小小片刻，都值得我们认真记住和表达。</p></article>' }).expect(200);
    const candidate = { ...response.body.theme, name: '我的测试主题', codeStyle };
    const saved = await request(instance.app).post('/api/themes').send({ theme: candidate }).expect(201);
    expect(saved.body.theme.custom).toBe(true);
    expect(saved.body.theme.codeStyle).toBe(codeStyle);
    const list = await request(instance.app).get('/api/themes').expect(200);
    expect(list.body.themes).toHaveLength(builtInThemes.length + 1);
    expect(list.body.themes.find((theme: { id: string }) => theme.id === candidate.id)).toMatchObject({ name: '我的测试主题', codeStyle });
    await request(instance.app).delete(`/api/themes/${candidate.id}`).expect(200);
    expect(instance.service.themes).toHaveLength(0);
  });
});

describe('Local access and file boundaries', () => {
  it('rejects external origins and DNS rebinding hosts', async () => {
    await request(instance.app).get('/api/workspace').set('Origin', 'https://example.com').expect(403);
    await request(instance.app).get('/api/workspace').set('Host', 'attacker.example:3001').expect(403);
    await request(instance.app).get('/api/workspace').set('Sec-Fetch-Site', 'cross-site').expect(403);
  });
  it('rejects path traversal for reads, writes and creation', async () => {
    await fs.writeFile(path.join(temporary, 'outside.md'), '# Private');
    await request(instance.app).get('/api/article').query({ path: '../outside.md' }).expect(403);
    await request(instance.app).post('/api/articles').send({ path: '../outside.md', content: '# Wrong' }).expect(403);
    await request(instance.app).get('/api/article').query({ path: path.join(temporary, 'outside.md') }).expect(400);
    expect(await fs.readFile(path.join(temporary, 'outside.md'), 'utf8')).toBe('# Private');
  });
  it('does not follow links to files outside the article directory', async () => {
    const outside = path.join(temporary, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.md'), '# Private');
    await fs.symlink(outside, path.join(articles, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await request(instance.app).get('/api/article').query({ path: 'linked/private.md' }).expect(403);
    expect((await instance.service.list()).articles).toHaveLength(2);
  });
  it('serves local images but not HTML, arbitrary files or traversing paths', async () => {
    await fs.writeFile(path.join(articles, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const response = await request(instance.app).get('/api/assets').query({ path: 'picture.svg' }).expect(200);
    expect(response.headers['content-security-policy']).toContain('sandbox');
    await request(instance.app).get('/api/assets').query({ path: 'article.md' }).expect(400);
    await request(instance.app).get('/api/assets').query({ path: '../private.png' }).expect(403);
  });
  it('validates article types, theme settings and import filenames', async () => {
    await request(instance.app).post('/api/articles').send({ path: 'script.html', content: '<script>x</script>' }).expect(400);
    await request(instance.app).put('/api/article-settings').send({ path: 'article.md', settings: { ...defaultSettings(), fontSize: 300 } }).expect(400);
    await request(instance.app).post('/api/articles/import').send({ files: [{ name: '../outside.md', content: '# Escape' }] }).expect(400);
    await request(instance.app).post('/api/themes/extract').send({ url: 'http://127.0.0.1:3001/api/workspace' }).expect(400);
  });
});
