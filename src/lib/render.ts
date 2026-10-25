import DOMPurify from 'dompurify';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import { getCodePalette, fontFamilies } from '../../shared/themes';
import { articleTitle, parseDocument } from '../../shared/document';
import type { ArticleSettings, CssRules, Theme } from '../../shared/types';

export interface RenderResult { html: string; text: string; localImages: number; title: string }
const px = (value: number) => `${Math.round(value * 100) / 100}px`;
const apply = (element: HTMLElement, rules: CssRules) => { for (const [key, value] of Object.entries(rules)) element.style.setProperty(key, value); };
const escapeText = (value: string) => { const element = document.createElement('span'); element.textContent = value; return element.innerHTML; };
const languageNames: Record<string, string> = { js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', jsx: 'JSX', tsx: 'TSX', py: 'Python', python: 'Python', sh: 'Shell', bash: 'Shell', shell: 'Shell', powershell: 'PowerShell', ps1: 'PowerShell', java: 'Java', cs: 'C#', csharp: 'C#', cpp: 'C++', c: 'C', go: 'Go', rust: 'Rust', text: 'TEXT', plaintext: 'TEXT' };

function renderTextDiagram(element: HTMLElement, code: string) {
  const layout = { 'font-family': fontFamilies.mono, 'white-space': 'pre', 'word-break': 'normal', 'overflow-wrap': 'normal', 'letter-spacing': '0', 'word-spacing': '0', 'font-variant-ligatures': 'none', 'line-height': '1.2', 'tab-size': '4' };
  apply(element.parentElement!, { ...layout, 'overflow-x': 'auto', 'max-width': '100%', 'box-sizing': 'border-box' });
  apply(element, layout);

  // CJK fallback fonts do not necessarily occupy two Latin monospace cells.
  // Keep the original characters, but give wide glyphs explicit grid widths.
  const wideGlyph = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/gu;
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const match of code.matchAll(wideGlyph)) {
    fragment.append(code.slice(offset, match.index));
    const cell = document.createElement('span');
    cell.textContent = match[0];
    apply(cell, { display: 'inline-block', width: '2ch', 'text-align': 'center' });
    fragment.append(cell);
    offset = match.index + match[0].length;
  }
  fragment.append(code.slice(offset));
  element.replaceChildren(fragment);
}

function themeRules(theme: Theme, settings: ArticleSettings): Record<string, CssRules> {
  const { fontSize, lineHeight, paragraphSpacing, accent } = settings;
  const palette = getCodePalette(theme.codeStyle);
  const framedCode = theme.codeStyle === 'dark' || theme.codeStyle === 'warm';
  const codeSize = framedCode ? px(Math.max(12, Math.min(16, fontSize - 2))) : '12px';
  const heading = { color: accent, 'font-family': fontFamilies[theme.headingFont], 'font-weight': '700', 'line-height': '1.55', 'margin-top': '32px', 'margin-bottom': '18px' };
  const h2: CssRules = { ...heading, 'font-size': px(fontSize + 4) };
  if (theme.headingStyle === 'bar') Object.assign(h2, { 'border-left': `3px solid ${accent}`, 'padding-left': '12px' });
  if (theme.headingStyle === 'underline') Object.assign(h2, { 'border-bottom': `1px solid ${accent}`, 'padding-bottom': '10px' });
  if (theme.headingStyle === 'centered') Object.assign(h2, { 'text-align': 'center', 'letter-spacing': '2px', 'margin-top': '36px' });
  if (theme.headingStyle === 'pill') Object.assign(h2, { 'background-color': theme.soft, padding: '9px 14px', 'border-radius': '5px' });
  const blockquote: CssRules = { color: theme.muted, 'font-size': px(fontSize - 1), 'line-height': String(lineHeight), margin: '24px 0', padding: '2px 0 2px 16px', 'border-left': `3px solid ${accent}` };
  if (theme.quoteStyle === 'card') Object.assign(blockquote, { 'background-color': theme.soft, color: theme.accent, padding: '17px 19px', 'border-left': `2px solid ${accent}`, 'border-radius': '0 4px 4px 0' });
  if (theme.quoteStyle === 'plain') Object.assign(blockquote, { 'text-align': 'center', 'border-left': 'none', padding: '16px 8px', 'font-style': 'italic', 'border-top': `1px solid ${theme.soft}`, 'border-bottom': `1px solid ${theme.soft}` });
  return {
    body: { margin: '0', padding: '30px 25px 24px', 'box-sizing': 'border-box', 'font-family': fontFamilies[settings.font], 'font-size': px(fontSize), 'line-height': String(lineHeight), color: theme.ink, 'background-color': '#ffffff', 'letter-spacing': '0.5px', 'word-wrap': 'break-word', 'overflow-wrap': 'break-word', 'text-align': settings.justify ? 'justify' : 'left' },
    h1: { ...heading, color: theme.ink, 'font-size': px(fontSize + 12), 'line-height': '1.55', 'letter-spacing': '1px', 'margin-top': '10px', 'margin-bottom': '16px', ...(theme.headingStyle === 'centered' ? { 'text-align': 'center' } : {}) },
    h2,
    h3: { ...heading, 'font-size': px(fontSize + 2), 'margin-top': '26px', 'margin-bottom': '14px' },
    h4: { ...heading, 'font-size': px(fontSize + 1) },
    h5: { ...heading, 'font-size': px(fontSize) },
    h6: { ...heading, 'font-size': px(fontSize) },
    p: { margin: `0 0 ${paragraphSpacing}px`, 'font-size': px(fontSize), 'line-height': String(lineHeight), 'text-align': settings.justify ? 'justify' : 'left' },
    strong: { color: accent, 'font-weight': '700' },
    b: { color: accent, 'font-weight': '700' },
    em: { 'font-style': 'italic' },
    blockquote,
    ul: { margin: `0 0 ${paragraphSpacing}px`, padding: '0 0 0 23px', 'list-style-type': 'disc' },
    ol: { margin: `0 0 ${paragraphSpacing}px`, padding: '0 0 0 23px', 'list-style-type': 'decimal' },
    li: { margin: '6px 0', 'line-height': String(lineHeight), 'font-size': px(fontSize) },
    a: { color: accent, 'text-decoration': 'none', 'border-bottom': `1px solid ${accent}`, 'word-break': 'break-all' },
    hr: { border: 'none', 'border-top': `1px solid ${theme.soft}`, margin: '32px 0', height: '0' },
    img: { display: 'block', 'max-width': '100%', height: 'auto', margin: '22px auto', 'border-radius': '4px' },
    pre: { margin: '22px 0', padding: '18px 16px', 'background-color': palette.background, 'border-radius': '5px', 'font-size': codeSize, 'line-height': '1.75', 'white-space': 'pre-wrap', 'word-break': 'break-word', color: palette.text, 'text-align': 'left', ...(framedCode ? { 'letter-spacing': '0', 'overflow-wrap': 'anywhere', 'tab-size': '2' } : {}) },
    code: { 'font-family': fontFamilies.mono, 'font-size': '0.88em', 'background-color': theme.soft, color: accent, padding: '2px 5px', 'border-radius': '3px', 'word-break': 'break-word' },
    table: { 'border-collapse': 'collapse', width: '100%', margin: '22px 0', 'font-size': px(fontSize - 2), 'line-height': '1.7', 'table-layout': 'fixed' },
    th: { 'background-color': theme.soft, color: accent, padding: '10px 8px', border: '1px solid #e6e9e7', 'font-weight': '600', 'text-align': 'left', 'word-break': 'break-word' },
    td: { padding: '10px 8px', border: '1px solid #e6e9e7', 'word-break': 'break-word' },
    del: { color: theme.muted, 'text-decoration': 'line-through' },
    sup: { 'font-size': '10px', color: accent, 'vertical-align': 'super', 'line-height': '0' },
  };
}

export function renderMarkdown(content: string, theme: Theme, settings: ArticleSettings, options: { filename?: string; articlePath?: string; directory?: string } = {}): RenderResult {
  const { metadata, body } = parseDocument(content);
  const title = articleTitle(content, options.filename || '未命名文章.md');
  const parsed = marked.parse(body, { gfm: true, breaks: true, async: false }) as string;
  const clean = DOMPurify.sanitize(parsed, { FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'svg', 'math', 'video', 'audio', 'object', 'embed', 'link', 'textarea', 'button', 'select'], FORBID_ATTR: ['style', 'id', 'srcset', 'target', 'width', 'height'], ALLOW_DATA_ATTR: false });
  const section = document.createElement('section');
  section.innerHTML = clean;
  if (!section.querySelector('h1') && settings.showTitle && title) {
    const heading = document.createElement('h1');
    heading.textContent = title;
    section.prepend(heading);
  }
  if (!settings.showTitle) section.querySelectorAll('h1').forEach((element) => element.remove());

  const rules = themeRules(theme, settings);
  const imported = theme.styles || {};
  for (const [role, customRules] of Object.entries(imported)) {
    if (!customRules) continue;
    const adjusted = { ...customRules };
    if (adjusted['font-size']?.endsWith('px')) adjusted['font-size'] = px(parseFloat(adjusted['font-size']) * settings.fontSize / theme.fontSize);
    rules[role] = { ...rules[role], ...adjusted };
  }
  Object.assign(rules.body, { 'font-family': fontFamilies[settings.font], 'font-size': px(settings.fontSize), 'line-height': String(settings.lineHeight), 'text-align': settings.justify ? 'justify' : 'left' });
  Object.assign(rules.p, { 'font-family': fontFamilies[settings.font], 'font-size': px(settings.fontSize), 'line-height': String(settings.lineHeight), 'margin-bottom': px(settings.paragraphSpacing), 'text-align': settings.justify ? 'justify' : 'left' });
  if (settings.accent !== theme.accent) {
    for (const role of ['h2', 'h3', 'strong', 'b', 'a']) rules[role].color = settings.accent;
    for (const role of ['h2', 'blockquote']) for (const key of ['border-left', 'border-bottom']) if (rules[role][key] && rules[role][key] !== 'none') rules[role][key] = rules[role][key].replace(/#[\da-f]{3,8}|rgba?\([^)]+\)/gi, settings.accent);
  }
  apply(section, rules.body);
  section.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const tag = element.tagName.toLowerCase();
    apply(element, rules[tag] || {});
  });

  section.querySelectorAll<HTMLElement>('blockquote p, li p').forEach((element) => { element.style.marginBottom = '6px'; if (element.closest('blockquote')) { element.style.color = 'inherit'; element.style.fontSize = 'inherit'; } });
  section.querySelectorAll<HTMLElement>('blockquote p:last-child, li p:last-child').forEach((element) => { element.style.marginBottom = '0'; });
  section.querySelectorAll<HTMLElement>('pre code').forEach((element) => {
    const code = element.textContent || '';
    const language = element.className.match(/language-([\w+-]+)/)?.[1]?.toLowerCase();
    const isDiagram = (!language || ['text', 'plaintext', 'txt', 'ascii'].includes(language)) && /[\u2500-\u257f]/u.test(code);
    const palette = getCodePalette(theme.codeStyle);
    if (!isDiagram && code.length < 40000) {
      try {
        const result = language && hljs.getLanguage(language) ? hljs.highlight(code, { language }) : hljs.highlightAuto(code, ['javascript', 'typescript', 'python', 'css', 'json', 'bash', 'xml']);
        element.innerHTML = DOMPurify.sanitize(result.value, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] });
      } catch { element.textContent = code; }
    }
    apply(element, { 'background-color': 'transparent', color: palette.text, padding: '0', 'font-size': rules.pre['font-size'], 'border-radius': '0', border: 'none' });
    element.querySelectorAll<HTMLElement>('span').forEach((span) => {
      const className = span.className;
      const color = /comment|quote/.test(className) ? palette.comment : /keyword|selector|tag/.test(className) ? palette.keyword : /string|attr/.test(className) ? palette.string : /number|literal/.test(className) ? palette.number : /title|function/.test(className) ? palette.title : palette.text;
      span.style.color = color;
    });
    if (isDiagram) renderTextDiagram(element, code);
    if (theme.codeStyle === 'dark' || theme.codeStyle === 'warm') {
      const pre = element.parentElement!;
      const frame = document.createElement('section');
      apply(frame, { margin: rules.pre.margin, 'border-radius': '7px', overflow: 'hidden', 'background-color': rules.pre['background-color'], 'text-align': 'left' });
      const label = document.createElement('p');
      label.textContent = isDiagram ? 'TEXT' : language ? languageNames[language] || language.toUpperCase() : 'CODE';
      apply(label, { margin: '0', padding: '9px 16px', 'background-color': palette.header, color: palette.label, 'border-bottom': `1px solid ${palette.border}`, 'font-family': fontFamilies.mono, 'font-size': '10px', 'font-weight': '500', 'line-height': '1.5', 'letter-spacing': '0.8px', 'text-align': 'left' });
      pre.before(frame);
      frame.append(label, pre);
      apply(pre, { margin: '0', 'border-radius': '0' });
    }
  });

  let localImages = 0;
  section.querySelectorAll<HTMLImageElement>('img').forEach((element) => {
    const source = element.getAttribute('src') || '';
    if (!source) return;
    if (/^(https?:|data:image\/(png|jpe?g|gif|webp|avif);base64,)/i.test(source)) return;
    if (source.startsWith('//')) { element.src = `https:${source}`; return; }
    if (/^[a-z][a-z\d+.-]*:/i.test(source)) { element.removeAttribute('src'); return; }
    try {
      const basePath = (options.articlePath || '').split('/').slice(0, -1);
      const imagePath = decodeURIComponent(source.split(/[?#]/)[0]).replace(/\\/g, '/');
      const parts = imagePath.startsWith('/') ? [] : basePath;
      let valid = true;
      for (const part of imagePath.split('/')) {
        if (part === '..') { if (!parts.length) { valid = false; break; } parts.pop(); }
        else if (part && part !== '.') parts.push(part);
      }
      if (!valid) { element.removeAttribute('src'); return; }
      element.src = `${window.location.origin}/api/assets?${new URLSearchParams({ path: parts.join('/'), ...(options.directory ? { directory: options.directory } : {}) })}`;
      localImages++;
    } catch { element.removeAttribute('src'); }
  });

  if (settings.linkFootnotes) {
    const links = new Map<string, number>();
    section.querySelectorAll<HTMLAnchorElement>('a').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      const number = links.get(href) || links.size + 1;
      links.set(href, number);
      const sup = document.createElement('sup');
      sup.textContent = `[${number}]`;
      apply(sup, rules.sup);
      anchor.after(sup);
    });
    if (links.size) {
      const heading = document.createElement('h3');
      heading.textContent = '文中链接';
      apply(heading, rules.h3);
      section.append(heading);
      for (const [url, number] of links) {
        const line = document.createElement('p');
        line.textContent = `[${number}] ${url}`;
        apply(line, { ...rules.p, 'font-size': '11px', color: theme.muted, 'word-break': 'break-all', 'margin-bottom': '8px' });
        section.append(line);
      }
    }
  }

  const heading = section.querySelector('h1');
  if (metadata.category && settings.showTitle) {
    const category = document.createElement('p');
    category.textContent = metadata.category;
    apply(category, { 'font-family': fontFamilies.sans, 'font-size': '10px', 'letter-spacing': '3px', color: settings.accent, margin: '0 0 14px', 'line-height': '1.6', ...(theme.headingStyle === 'centered' ? { 'text-align': 'center' } : {}) });
    section.prepend(category);
  }
  if (settings.showMeta && (metadata.author || metadata.date)) {
    const meta = document.createElement('p');
    meta.textContent = [metadata.author, metadata.date].filter(Boolean).join('  ·  ');
    apply(meta, { 'font-family': fontFamilies.sans, 'font-size': '11px', color: theme.muted, 'line-height': '1.6', 'letter-spacing': '0.5px', margin: '0 0 28px', ...(theme.headingStyle === 'centered' ? { 'text-align': 'center' } : {}) });
    if (heading) heading.after(meta); else section.prepend(meta);
    if (metadata.summary) {
      const summary = document.createElement('p');
      summary.textContent = metadata.summary;
      apply(summary, { 'font-size': px(settings.fontSize - 1), color: theme.muted, 'line-height': String(settings.lineHeight), margin: '0 0 25px' });
      meta.after(summary);
    }
  }

  section.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (!['style', 'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
  });
  const plain = section.cloneNode(true) as HTMLElement;
  plain.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr').forEach((element) => element.append(document.createTextNode('\n')));
  return { html: section.outerHTML, text: plain.textContent?.trim() || '', localImages, title };
}

export async function copyPlainText(content: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return;
    } catch { /* Fall back to copying a plain-text selection. */ }
  }
  const holder = document.createElement('textarea');
  holder.value = content;
  holder.readOnly = true;
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
  const activeElement = document.activeElement as HTMLElement | null;
  document.body.append(holder);
  let copied = false;
  try {
    holder.select();
    copied = document.execCommand('copy');
  } catch { /* Report the same actionable error when both methods fail. */ }
  finally { holder.remove(); activeElement?.focus({ preventScroll: true }); }
  if (!copied) throw new Error('未能复制 Markdown，请允许剪贴板权限后重试，或在编辑区全选复制。');
}

export async function copyRichText(rendered: RenderResult) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([rendered.html], { type: 'text/html' }), 'text/plain': new Blob([rendered.text], { type: 'text/plain' }) })]);
      return;
    } catch { /* Browsers without rich clipboard permission can still use a selection. */ }
  }
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:500px;';
  holder.innerHTML = rendered.html;
  document.body.append(holder);
  const selection = window.getSelection();
  const previous = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const activeElement = document.activeElement as HTMLElement | null;
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let copied = false;
  try { copied = document.execCommand('copy'); }
  finally { holder.remove(); selection?.removeAllRanges(); if (previous) selection?.addRange(previous); activeElement?.focus(); }
  if (!copied) throw new Error('浏览器未允许复制，请允许剪贴板权限，或使用「导出 HTML」。');
}

export function downloadFile(content: string, filename: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/:*?"<>|]/g, '-');
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function exportHtml(rendered: RenderResult) {
  downloadFile(`<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(rendered.title)}</title></head><body style="margin:0 auto;max-width:677px;background:#fff">${rendered.html}</body></html>`, `${rendered.title}.html`, 'text/html;charset=utf-8');
}
