// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { builtInThemes, defaultSettings } from '../shared/themes';
import { renderMarkdown } from '../src/lib/render';
import { publishCodeBlocks } from '../src/lib/publish-code';

function published(source: string, language = 'python', theme = builtInThemes[1]) {
  const preview = renderMarkdown('# 示例\n\n```' + language + '\n' + source + '\n```\n\n行内 `inline()` 与后续正文。', theme, defaultSettings(theme));
  const html = publishCodeBlocks(preview.html);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const strip = [...doc.querySelectorAll<HTMLElement>('section')].find((node) => node.style.display === '-webkit-box')!;
  const content = strip.firstElementChild as HTMLElement;
  const rows = [...content.children].filter((node): node is HTMLSpanElement => node.tagName === 'SPAN');
  return { preview, html, doc, strip, content, rows, text: rows.map((row) => row.textContent!.replaceAll('\u00a0', ' ')) };
}

describe('published code lines', () => {
  const lines = [
    'if some_list:        # 等价于 if len(some_list) > 0:',
    '    print("列表非空")',
    '',
    'print(0.1 + 0.2 == 0.3)   # False！精度问题（1.1 提到过的浮点精度陷阱在这里现形了）',
    'print(abs(0.1 + 0.2 - 0.3) < 1e-9)   # True',
  ];
  it.each(builtInThemes)('keeps code and trailing Chinese comments in one row in $name', (theme) => {
    const result = published(lines.join('\n'), 'python', theme);
    expect(result.text).toEqual(lines.map((line) => line || ' '));
    expect(result.rows).toHaveLength(lines.length);
    expect(result.content.querySelectorAll(':scope > br')).toHaveLength(lines.length - 1);
    expect(result.doc.querySelector('pre')).toBeNull();
    expect(result.doc.querySelector('p code')?.textContent).toBe('inline()');
    expect((result.strip.parentElement as HTMLElement).style.overflowX).toBe('auto');
    for (const row of result.rows) {
      expect(row.style.whiteSpace).toBe('nowrap');
      expect(row.style.display).toBe('inline-block');
      expect(row.querySelector('br')).toBeNull();
    }
    expect(result.rows[3].textContent).toContain('#\u00a0False！');
    expect(result.rows[3].querySelector('span[style*="color"]')).not.toBeNull();
    expect(result.preview.text).toContain(lines.join('\n'));
  });

  it('splits multiline highlighted tokens without losing their styles or line order', () => {
    const source = ['const message = `首行', '  第二行 ${1 + 2}', '', '末行`; // 中文注释仍在右侧', '/* 多行注释', '   仍然高亮 */', 'const literal = "<script> & </span>";'];
    const { text, rows, doc } = published(source.join('\n'), 'javascript');
    expect(text).toEqual(source.map((line) => line || ' '));
    expect(rows[1].querySelector('span[style*="color"]')).not.toBeNull();
    expect(rows[5].querySelector('span[style*="color"]')).not.toBeNull();
    expect(doc.querySelector('script')).toBeNull();
  });

  it('preserves leading, internal and trailing blank lines without adding a terminal row', () => {
    const result = published('\nfirst  \n\nlast\n\n');
    expect(result.text).toEqual([' ', 'first  ', ' ', 'last', ' ']);
    expect(result.preview.text).toContain('\nfirst  \n\nlast\n');
    expect(publishCodeBlocks(result.html)).toBe(result.html);
  });

  it('expands tabs at tab stops across highlight spans and preserves original text separately', () => {
    const source = 'if\tTrue:\n\tprint("中文")\t# 说明';
    const result = published(source);
    expect(result.text).toEqual(['if  True:', '  print("中文") # 说明']);
    expect(result.preview.text).toContain(source);
    expect(result.rows.some((row) => row.textContent!.includes('\t'))).toBe(false);
  });

  it('keeps CJK diagram cells and converts only text-node spaces, not markup or entities', () => {
    const source = '┌────────┐\n│ "小明" │\n└────────┘\n\t<script title="a b"> &amp;';
    const result = published(source, 'text');
    expect(result.text).toEqual(['┌────────┐', '│ "小明" │', '└────────┘', '    <script title="a b"> &amp;']);
    const cells = result.rows[1].querySelectorAll<HTMLElement>('span[style*="2ch"]');
    expect([...cells].map((cell) => cell.textContent).join('')).toBe('小明');
    expect(result.doc.querySelector('script, [class], [onclick]')).toBeNull();
  });
});
