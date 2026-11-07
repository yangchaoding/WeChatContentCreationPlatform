import type { CssRules } from '../../shared/types';

const apply = (node: HTMLElement, styles: CssRules) => {
  for (const [name, value] of Object.entries(styles)) node.style.setProperty(name, value);
};
const noWrap = (node: HTMLElement) => {
  for (const [name, value] of Object.entries({ 'white-space': 'nowrap', 'word-break': 'normal', 'overflow-wrap': 'normal', 'word-wrap': 'normal' })) node.style.setProperty(name, value, 'important');
};

function characterCells(character: string): number {
  if (/\p{Mark}/u.test(character)) return 0;
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{1f000}-\u{1ffff}\u{20000}-\u{3fffd}]/u.test(character) ? 2 : 1;
}

/** Preserve source lines through rich-text editors that rewrite pre/code styles. */
export function publishCodeBlocks(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  for (const pre of root.querySelectorAll<HTMLElement>('pre')) {
    const code = pre.querySelector<HTMLElement>('code');
    if (!code) continue;
    const scroll = document.createElement('section');
    scroll.style.cssText = pre.style.cssText;
    apply(scroll, { display: 'block', width: '100%', 'max-width': '100%', 'box-sizing': 'border-box', 'overflow-x': 'auto', 'overflow-y': 'hidden', '-webkit-overflow-scrolling': 'touch' });
    // Avoid WeChat's pre/code-specific rewriting. A single legacy flex child
    // keeps the entire source line's intrinsic width instead of shrinking it.
    const strip = document.createElement('section');
    strip.style.cssText = code.style.cssText;
    apply(strip, { display: '-webkit-box', width: '100%', 'min-width': '0', 'max-width': 'none', margin: '0', padding: '0', overflow: 'visible', 'box-sizing': 'border-box', '-webkit-box-orient': 'horizontal' });
    noWrap(strip);
    const content = document.createElement('span');
    apply(content, { display: 'block', 'min-width': '100%', 'max-width': 'none', '-webkit-box-flex': '0', 'flex-shrink': '0', 'font-family': 'inherit', 'font-size': 'inherit', 'line-height': 'inherit' });
    noWrap(content);

    const makeLine = () => {
      const line = document.createElement('span');
      apply(line, { display: 'inline-block', 'max-width': 'none', 'vertical-align': 'top', 'font-family': 'inherit', 'font-size': 'inherit', 'line-height': 'inherit' });
      noWrap(line);
      return line;
    };
    const lines = [makeLine()];
    let line = lines[0];
    let column = 0;
    const tabSize = Math.max(1, Math.min(16, Number(pre.style.tabSize) || 4));
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const clones = new Map<HTMLElement, HTMLElement>();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parents: HTMLElement[] = [];
      for (let parent = node.parentElement; parent && parent !== code; parent = parent.parentElement) parents.unshift(parent);
      const parts = (node.textContent || '').split(/\r\n|\r|\n/);
      parts.forEach((part, index) => {
        if (index) {
          line = makeLine(); lines.push(line); clones.clear(); column = 0;
        }
        if (!part) return;
        let target = line;
        for (const parent of parents) {
          let clone = clones.get(parent);
          if (!clone) {
            clone = parent.cloneNode(false) as HTMLElement;
            noWrap(clone);
            target.append(clone);
            clones.set(parent, clone);
          }
          target = clone;
        }
        let text = '';
        for (const character of part) {
          if (character === '\t') {
            const spaces = tabSize - column % tabSize;
            text += '\u00a0'.repeat(spaces); column += spaces;
          } else {
            text += character === ' ' ? '\u00a0' : character;
            column += characterCells(character);
          }
        }
        target.append(document.createTextNode(text));
      });
    }
    // A final newline terminates the last source line; it is not an extra row.
    if (lines.length > 1 && !lines.at(-1)!.textContent) lines.pop();
    lines.forEach((row, index) => {
      if (index) content.append(document.createElement('br'));
      if (!row.textContent) row.append('\u00a0');
      content.append(row);
    });
    strip.append(content);
    scroll.append(strip);
    pre.replaceWith(scroll);
  }
  return root.innerHTML;
}
