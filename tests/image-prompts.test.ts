import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalApp } from '../server/app';
import { defaultCoverPrompts } from '../shared/image-prompts';

describe('saved cover prompts', () => {
  let temporary: string;
  let instance: Awaited<ReturnType<typeof createLocalApp>>;
  const start = () => createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: path.join(temporary, 'articles') });
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mopai-prompts-'));
    await fs.mkdir(path.join(temporary, 'articles'));
    instance = await start();
  });
  afterEach(async () => {
    await instance.close();
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('mopai-prompts-')) throw new Error('Unexpected cleanup path');
    await fs.rm(temporary, { recursive: true, force: true });
  });
  it('starts with the original editable prompt and saves prompts without API credentials', async () => {
    expect((await request(instance.app).get('/api/image-prompts').expect(200)).body).toEqual(defaultCoverPrompts());
    const settings = (await request(instance.app).get('/api/image-settings')).body;
    const saved = await request(instance.app).post('/api/image-prompts').send({ id: 'default', name: '我的插画', content: ' 温暖的水彩插画，保留中文标题。\n以文章内容构图。 ' }).expect(200);
    expect(saved.body).toEqual({ selectedId: 'default', prompts: [{ id: 'default', name: '我的插画', content: '温暖的水彩插画，保留中文标题。\n以文章内容构图。' }] });
    expect((await request(instance.app).get('/api/image-settings')).body).toEqual(settings);
  });
  it('persists new prompts, edits and the last selection across restarts', async () => {
    const saved = await request(instance.app).post('/api/image-prompts').send({ name: '摄影封面', content: '自然光摄影，浅景深。' }).expect(200);
    const id = saved.body.selectedId;
    expect(saved.body.prompts).toHaveLength(2);
    await instance.close(); instance = await start();
    expect((await request(instance.app).get('/api/image-prompts')).body).toEqual(saved.body);
    const edited = await request(instance.app).post('/api/image-prompts').send({ id, name: '摄影封面新版', content: '自然光摄影，横向构图。' }).expect(200);
    expect(edited.body.prompts).toHaveLength(2);
    const selected = await request(instance.app).put('/api/image-prompts/selection').send({ id: 'default' }).expect(200);
    await instance.close(); instance = await start();
    expect((await request(instance.app).get('/api/image-prompts')).body).toEqual(selected.body);
    expect(selected.body.prompts[1].content).toBe('自然光摄影，横向构图。');
  });
  it('rejects invalid, missing and duplicate prompts without changing the library', async () => {
    for (const input of [null, [], {}, { name: '', content: 'test' }, { name: 'Test', content: ' ' }, { name: 'n'.repeat(61), content: 'test' }, { name: 'Test', content: 'x'.repeat(2001) }, { name: 'Bad\nName', content: 'test' }]) {
      await request(instance.app).post('/api/image-prompts').set('Content-Type', 'application/json').send(JSON.stringify(input)).expect(400);
    }
    await request(instance.app).post('/api/image-prompts').send({ id: 'missing', name: 'Test', content: 'test' }).expect(404);
    await request(instance.app).post('/api/image-prompts').send({ name: defaultCoverPrompts().prompts[0].name, content: 'test' }).expect(409);
    await request(instance.app).put('/api/image-prompts/selection').send({ id: 'missing' }).expect(404);
    expect((await request(instance.app).get('/api/image-prompts')).body).toEqual(defaultCoverPrompts());
  });
  it('keeps both prompts when separate windows save new entries concurrently', async () => {
    await Promise.all(['水彩', '摄影'].map((name) => request(instance.app).post('/api/image-prompts').send({ name, content: `${name}风格的文章封面。` }).expect(200)));
    const library = (await request(instance.app).get('/api/image-prompts')).body;
    expect(library.prompts.map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining(['水彩', '摄影']));
    expect(library.prompts).toHaveLength(3);
    expect(JSON.parse(await fs.readFile(path.join(temporary, 'state/image-prompts.json'), 'utf8'))).toEqual(library);
  });
});
