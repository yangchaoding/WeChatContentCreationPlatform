// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import Sidebar from '../src/components/Sidebar';
import type { ArticleSummary, Workspace } from '../shared/types';

const course = 'AI Agent开发';
const phase = `${course}/阶段一：Python编程基础`;
const exercises = `${phase}/练习`;
const sibling = `${course}/阶段二：计算机与开发工具基础`;
const summary = (path: string): ArticleSummary => ({
  path, name: path.split('/').at(-1)!, title: `标题 ${path}`,
  modifiedAt: '2026-10-25T00:00:00Z', size: 100,
});

describe('workspace article navigation', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let workspace: Workspace;
  let selectedPath: string | undefined;
  let onSelect: Mock<(path: string) => void>;
  let onClose: Mock<() => void>;
  let onCreate: Mock;
  let onCreateFolder: Mock;
  let onSwitchDirectory: Mock;
  const searchRef = createRef<HTMLInputElement>();
  const render = () => act(() => root.render(createElement(Sidebar, {
    workspace, selectedPath, connected: true, mobileOpen: false,
    onSelect, onClose, onCollapse: vi.fn(), onDirectory: vi.fn(),
    onCreate, onCreateFolder, onSwitchDirectory, onImport: vi.fn(), onHelp: vi.fn(), searchRef,
  })));
  const byPath = (selector: string, path: string) => [...host.querySelectorAll<HTMLButtonElement>(selector)].find((el) => el.title === path);
  const folder = (path: string) => byPath('.folder-heading', path);
  const article = (path: string) => byPath('.article-item', path);
  const click = (button: HTMLButtonElement | undefined) => {
    expect(button).toBeDefined();
    act(() => button!.click());
  };
  const search = (value: string) => act(() => {
    const input = searchRef.current!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    workspace = { directory: 'D:/articles', name: 'articles', directories: [], truncated: false, articles: [
      summary('根目录.md'), summary(`${course}/大纲.md`),
      summary(`${phase}/1.10_ 异常处理.md`), summary(`${phase}/1.2_ 字符串.md`),
      summary(`${exercises}/同名.md`), summary(`${sibling}/Git.md`),
      summary('其他课程/练习/同名.md'),
    ] };
    selectedPath = '根目录.md';
    onSelect = vi.fn();
    onClose = vi.fn();
    onCreate = vi.fn(); onCreateFolder = vi.fn(); onSwitchDirectory = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('renders real nested folders, including intermediate folders without direct articles', () => {
    expect(folder(course)!.querySelector('span')!.textContent).toBe(course);
    expect(folder(phase)!.querySelector('span')!.textContent).toBe('阶段一：Python编程基础');
    expect(folder(course)!.parentElement!.contains(folder(phase)!)).toBe(true);
    expect(folder(phase)!.parentElement!.contains(folder(exercises)!)).toBe(true);
    expect(folder('其他课程')!.parentElement!.contains(folder('其他课程/练习')!)).toBe(true);
    expect(folder(course)!.querySelector('small')!.textContent).toBe('5');
    const directFiles = [...folder(phase)!.parentElement!.querySelectorAll(':scope > ul > li > .article-item')];
    expect(directFiles.map((el) => el.getAttribute('title'))).toEqual([`${phase}/1.2_ 字符串.md`, `${phase}/1.10_ 异常处理.md`]);
  });

  it('shows Chinese stages in numeric order while keeping folders before articles', () => {
    const names = ['阶段一：Python编程基础', '阶段二：计算机与开发工具基础', '阶段四：AI - 机器学习基础概念', '阶段五：大语言模型与 Prompt Engineering', '阶段六：AI Agent 核心技术', '阶段十：综合项目'];
    workspace = { ...workspace, directories: [...names].reverse().map((name) => `${course}/${name}`) };
    render();
    const children = folder(course)!.parentElement!.querySelectorAll(':scope > ul > li > .folder-heading');
    expect([...children].map((node) => node.textContent!.replace(/\d+$/, ''))).toEqual(names);
    expect(folder(course)!.parentElement!.querySelector(':scope > ul > li:last-child > .article-item')?.getAttribute('title')).toBe(`${course}/大纲.md`);
  });

  it('creates articles and folders beside their exact destination without toggling the folder', () => {
    click(folder(phase));
    const actions = folder(phase)!.parentElement!.querySelector('.folder-actions')!;
    click(actions.querySelector<HTMLButtonElement>('button[aria-label$="中新建文章"]')!);
    expect(onCreate).toHaveBeenLastCalledWith(phase, workspace.directory);
    expect(folder(phase)!.getAttribute('aria-expanded')).toBe('true');
    click(actions.querySelector<HTMLButtonElement>('button[aria-label$="中新建子文件夹"]')!);
    expect(onCreateFolder).toHaveBeenLastCalledWith(phase, workspace.directory);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('lists saved workspace folders and sends the correct root for switching and quick creation', () => {
    workspace = { ...workspace, folders: [{ directory: workspace.directory, name: 'articles' }, { directory: 'D:/other', name: '另一个文件夹' }] };
    render();
    const other = byPath('.workspace-heading', 'D:/other')!;
    expect(other.getAttribute('aria-expanded')).toBe('false');
    click(other);
    expect(onSwitchDirectory).toHaveBeenCalledWith('D:/other');
    click(other.parentElement!.querySelector<HTMLButtonElement>('button[aria-label$="中新建文章"]')!);
    expect(onCreate).toHaveBeenCalledWith('', 'D:/other');
    const active = byPath('.workspace-heading', workspace.directory)!;
    click(active);
    expect(active.getAttribute('aria-expanded')).toBe('false');
    expect(article('根目录.md')).toBeUndefined();
    click(active);
    expect(article('根目录.md')).toBeDefined();
  });

  it('folds entire subtrees and preserves independent child and sibling expansion', () => {
    click(folder(exercises));
    click(folder(course));
    expect(folder(course)!.getAttribute('aria-expanded')).toBe('false');
    expect(folder(phase)).toBeUndefined();
    expect(article(`${sibling}/Git.md`)).toBeUndefined();
    expect(article('其他课程/练习/同名.md')).toBeDefined();
    expect(article('根目录.md')).toBeDefined();
    click(folder(course));
    expect(folder(exercises)!.getAttribute('aria-expanded')).toBe('false');
    expect(article(`${exercises}/同名.md`)).toBeUndefined();
    expect(article(`${sibling}/Git.md`)).toBeDefined();
  });

  it('selects articles across folders using full paths even when filenames match', () => {
    for (const path of [`${exercises}/同名.md`, '其他课程/练习/同名.md', '根目录.md']) {
      click(article(path));
      expect(onSelect).toHaveBeenLastCalledWith(path);
      selectedPath = path;
      render();
      expect(host.querySelectorAll('.article-item[aria-current="page"]')).toHaveLength(1);
      expect(article(path)!.classList.contains('active')).toBe(true);
    }
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('reveals search matches and ancestors while retaining normal folding when search is cleared', () => {
    click(folder(course));
    search('  gIT  ');
    expect(folder(course)!.getAttribute('aria-expanded')).toBe('true');
    expect(folder(phase)).toBeUndefined();
    expect(article(`${sibling}/Git.md`)).toBeDefined();
    click(folder(sibling));
    expect(folder(sibling)!.getAttribute('aria-expanded')).toBe('false');
    expect(article(`${sibling}/Git.md`)).toBeUndefined();
    search('阶段一');
    expect(article(`${exercises}/同名.md`)).toBeDefined();
    search('');
    expect(folder(course)!.getAttribute('aria-expanded')).toBe('false');
    expect(folder(phase)).toBeUndefined();
  });

  it('keeps a selected search result visible after clearing search', () => {
    click(folder(course));
    search('Git');
    click(article(`${sibling}/Git.md`));
    selectedPath = `${sibling}/Git.md`;
    render();
    search('');
    expect(article(selectedPath)!.getAttribute('aria-current')).toBe('page');
    click(folder(course));
    workspace = { ...workspace, articles: [...workspace.articles] };
    render();
    expect(folder(course)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('clears stale search and fold state when switching workspaces with matching relative paths', () => {
    click(folder(course));
    search('no results');
    expect(host.textContent).toContain('没有找到相关文章');
    workspace = { ...workspace, directory: 'D:/another-workspace' };
    render();
    expect(searchRef.current!.value).toBe('');
    expect(folder(course)!.getAttribute('aria-expanded')).toBe('true');
    expect(article(`${exercises}/同名.md`)).toBeDefined();
  });

  it('shows newly discovered descendants while preserving folds in the same workspace', () => {
    click(folder(phase));
    workspace = { ...workspace, articles: [...workspace.articles, summary(`${course}/新增阶段/进阶/新文章.md`)] };
    render();
    expect(folder(phase)!.getAttribute('aria-expanded')).toBe('false');
    expect(article(`${course}/新增阶段/进阶/新文章.md`)).toBeDefined();
    expect(folder(course)!.querySelector('small')!.textContent).toBe('6');
  });

  it('distinguishes an empty workspace from no matching search results', () => {
    search('不存在的文章');
    expect(host.textContent).toContain('没有找到相关文章');
    workspace = { ...workspace, directory: 'D:/empty-workspace', articles: [] };
    render();
    expect(host.textContent).toContain('从第一篇文章开始');
  });

  it('displays and searches directories without Markdown files, including an entirely empty branch', () => {
    const empty = `${course}/阶段四：机器学习/待整理`;
    workspace = { ...workspace, directories: [course, `${course}/阶段四：机器学习`, empty] };
    render();
    expect(folder(empty)!.querySelector('small')!.textContent).toBe('0');
    expect(folder(empty)!.parentElement!.textContent).toContain('暂无 .md 文章');
    click(folder(empty));
    expect(folder(empty)!.parentElement!.textContent).not.toContain('暂无 .md 文章');
    search('待整理');
    expect(folder(empty)!.getAttribute('aria-expanded')).toBe('true');
    expect(folder(phase)).toBeUndefined();
    search('');
    workspace = { ...workspace, articles: [] };
    render();
    expect(folder(course)).toBeDefined();
    expect(folder(empty)).toBeDefined();
    expect(host.textContent).not.toContain('从第一篇文章开始');
  });
});
