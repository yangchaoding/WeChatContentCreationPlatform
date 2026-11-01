import { randomUUID } from 'node:crypto';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import { builtInThemes } from '../shared/themes';
import type { CssRules, SemanticRole, Theme } from '../shared/types';
import { AppError } from './workspace';

const MAX_HTML = 4 * 1024 * 1024;
// Downloaded WeChat pages include large script bundles unrelated to article styles.
const MAX_REMOTE_HTML = 16 * 1024 * 1024;
const allowedProperties = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-indent', 'margin-top', 'margin-bottom', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'border-left', 'border-bottom', 'border-top', 'border-right', 'border-color', 'border-left-color', 'border-bottom-color', 'border-width', 'border-style', 'border-radius', 'text-decoration']);
const inheritedProperties = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'letter-spacing', 'text-align']);

export function safeStyles(input: unknown): CssRules {
  if (!input || typeof input !== 'object') return {};
  const result: CssRules = {};
  for (const [property, raw] of Object.entries(input)) {
    if (!allowedProperties.has(property) || typeof raw !== 'string') continue;
    const value = raw.replace(/!important/gi, '').trim();
    if (value.length > 160 || /url\s*\(|expression|@import|javascript|var\s*\(|calc\s*\(|[<>;{}\\]/i.test(value)) continue;
    if (!/^[\w\s#(),.%'"\-\u3400-\u9fff]+$/.test(value)) continue;
    if (property === 'font-size' && (!/^\d+(\.\d+)?px$/.test(value) || parseFloat(value) < 12 || parseFloat(value) > 40)) continue;
    if (property === 'line-height') {
      const size = parseFloat(value);
      if (!/^\d+(\.\d+)?(px|em|%)?$/.test(value) || size <= 0 || (value.endsWith('px') ? size > 64 : value.endsWith('%') ? size > 260 : size > 2.6)) continue;
    }
    if (/^(padding|margin|text-indent|border-radius)/.test(property) && value.split(/\s+/).some((part) => !/^\d+(\.\d+)?(px|em)?$/.test(part) || parseFloat(part) > 48 || (/em$/.test(part) && parseFloat(part) > 3))) continue;
    if (property === 'letter-spacing' && (!/^-?\d+(\.\d+)?px$/.test(value) || Math.abs(parseFloat(value)) > 4)) continue;
    if (property === 'text-align' && !['left', 'center', 'justify', 'right', 'start'].includes(value)) continue;
    result[property] = value;
  }
  return result;
}

function declarationStyles(style: string): CssRules {
  const values: CssRules = {};
  try {
    postcss.parse(`x{${style}}`).walkDecls((declaration) => { values[declaration.prop.toLowerCase()] = declaration.value; });
  } catch { return {}; }
  return safeStyles(values);
}

export function validateWeChatUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new AppError(400, '请输入完整的微信公众号文章链接。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com' || url.username || url.password || (url.port && url.port !== '443') || !/^\/s(?:\/|$)/.test(url.pathname)) {
    throw new AppError(400, '仅支持 https://mp.weixin.qq.com/s 开头的公众号文章链接。');
  }
  url.hash = '';
  return url;
}

export async function fetchWeChatArticle(input: string): Promise<{ html: string; url: string }> {
  let url = validateWeChatUrl(input);
  const signal = AbortSignal.timeout(18000);
  for (let redirects = 0; redirects < 5; redirects++) {
    let response: Response;
    try {
      response = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    } catch { throw new AppError(502, '暂时无法连接微信。请检查网络，或保存文章网页后使用「导入网页」。', 'FETCH_FAILED'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new AppError(502, '文章链接重定向无效。');
      try { url = validateWeChatUrl(new URL(location, url).href); }
      catch { throw new AppError(422, '微信将此链接转到了验证页面。请在浏览器打开文章并保存为 HTML 后导入。', 'WECHAT_RESTRICTED'); }
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new AppError(502, '微信暂时没有返回文章，请稍后重试或导入已保存的网页。'); }
    if (Number(response.headers.get('content-length')) > MAX_REMOTE_HTML) { await response.body?.cancel(); throw new AppError(413, '网页下载内容超过 16 MB，请导入仅包含正文和样式的 HTML。'); }
    if (!response.body) throw new AppError(502, '没有读取到文章内容。');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_REMOTE_HTML) { await reader.cancel(); throw new AppError(413, '网页下载内容超过 16 MB，请导入仅包含正文和样式的 HTML。'); }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, '读取文章超时，请稍后重试或导入保存的网页。');
    } finally { reader.releaseLock(); }
    const $ = cheerio.load(Buffer.concat(chunks).toString('utf8'));
    if (!$('#js_content').length) throw new AppError(422, '微信没有返回文章正文，可能需要验证或文章已失效。请在浏览器保存完整网页，再使用「导入网页」。', 'WECHAT_RESTRICTED');
    // Retain embedded CSS, title metadata and ancestor markup used by CSS selectors.
    $('script, noscript, iframe').remove();
    $.root().find('*').contents().filter((_, node) => node.type === 'comment').remove();
    const html = $.html();
    if (Buffer.byteLength(html) > MAX_HTML) throw new AppError(413, '移除网页脚本后的内容仍超过 4 MB，请导入仅包含正文和样式的 HTML。');
    return { html, url: url.href };
  }
  throw new AppError(502, '文章链接重定向次数过多，请复制最终文章地址。');
}

function colorHex(value?: string): string | undefined {
  if (!value) return;
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(value)) return '#' + value.slice(1).split('').map((part) => part + part).join('');
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return '#' + rgb.slice(1).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('');
  const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080' };
  return named[value.toLowerCase()];
}

function isAccent(value?: string) {
  const hex = colorHex(value);
  if (!hex) return false;
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  return Math.max(...rgb) - Math.min(...rgb) > 0.12 && Math.max(...rgb) > 0.2 && Math.min(...rgb) < 0.8;
}

function dominant(samples: { styles: CssRules; weight: number }[]): CssRules {
  const counts = new Map<string, Map<string, number>>();
  for (const { styles, weight } of samples) {
    for (const [key, value] of Object.entries(styles)) {
      const values = counts.get(key) || new Map<string, number>();
      values.set(value, (values.get(value) || 0) + weight);
      counts.set(key, values);
    }
  }
  return Object.fromEntries([...counts].map(([key, values]) => [key, [...values].sort((a, b) => b[1] - a[1])[0][0]]));
}

export function extractTheme(html: string, sourceUrl?: string): Theme {
  if (Buffer.byteLength(html) > MAX_HTML) throw new AppError(413, '网页不能超过 4 MB。');
  const $ = cheerio.load(html);
  const sourceTitle = $('#activity-name').text().trim() || $('meta[property="og:title"]').attr('content') || $('title').text().trim() || '导入的文章';
  let root = $('#js_content').first();
  if (!root.length) root = $('article, main, [role="main"]').first();
  if (!root.length) root = $('body').first();
  root.find('script, iframe, form, noscript, svg').remove();
  if (root.text().trim().length < 15) throw new AppError(422, '这个文件中没有足够的文章正文，请导入包含正文样式的完整 HTML 网页。');
  const cssMap = new Map<object, CssRules>();
  let rulesCount = 0;
  $('style').each((_, style) => {
    if (rulesCount >= 600) return;
    try {
      postcss.parse($(style).text()).walkRules((rule) => {
        if (rulesCount++ >= 600 || rule.selector.length > 300 || /:(hover|active|focus|visited|before|after)|::/.test(rule.selector)) return;
        const styles: CssRules = {};
        rule.walkDecls((declaration) => { styles[declaration.prop.toLowerCase()] = declaration.value; });
        const safe = safeStyles(styles);
        if (!Object.keys(safe).length) return;
        try { $(rule.selector).slice(0, 5000).each((_, element) => { cssMap.set(element, { ...cssMap.get(element), ...safe }); }); } catch { /* Unsupported selectors cannot contribute useful styles. */ }
      });
    } catch { /* Inline declarations remain usable when a stylesheet is malformed. */ }
  });
  const computedCache = new Map<object, CssRules>();
  const computed = (element: any): CssRules => {
    if (computedCache.has(element)) return computedCache.get(element)!;
    const ancestors = $(element).parents().toArray().reverse().slice(-20);
    let result: CssRules = { 'font-weight': '400', 'font-style': 'normal' };
    for (const ancestor of [...ancestors, element]) {
      result = Object.fromEntries(Object.entries(result).filter(([key]) => inheritedProperties.has(key)));
      const tagName = (ancestor as { name?: string }).name;
      if (tagName === 'strong' || tagName === 'b' || /^h[1-6]$/.test(tagName || '')) result['font-weight'] = '700';
      if (tagName === 'em' || tagName === 'i') result['font-style'] = 'italic';
      const scale: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17 };
      if (tagName && scale[tagName]) result['font-size'] = `${Math.min(40, (parseFloat(result['font-size'] || '16') || 16) * scale[tagName])}px`;
      result = { ...result, ...cssMap.get(ancestor), ...declarationStyles($(ancestor).attr('style') || '') };
    }
    computedCache.set(element, result);
    return result;
  };
  const effective = (element: any): CssRules => {
    const outer = computed(element);
    const samples: { styles: CssRules; weight: number }[] = [];
    const collect = (node: any, depth: number) => {
      if (depth > 12 || samples.length >= 150) return;
      if (node.type === 'text' && node.data?.trim() && node.parent) samples.push({ styles: Object.fromEntries(Object.entries(computed(node.parent)).filter(([key]) => inheritedProperties.has(key))), weight: node.data.trim().length });
      else for (const child of node.children || []) collect(child, depth + 1);
    };
    collect(element, 0);
    const inherited = dominant(samples);
    return { ...outer, ...inherited };
  };
  const styles: Theme['styles'] = { body: computed(root[0]) };
  let sampledElements = 0;
  const roles: SemanticRole[] = ['h1', 'h2', 'h3', 'p', 'strong', 'blockquote', 'a', 'ul', 'ol', 'li', 'pre', 'code', 'hr', 'img', 'table', 'th', 'td'];
  for (const role of roles) {
    const elements = root.find(role).toArray().filter((element) => role === 'img' || role === 'hr' || $(element).text().trim().length > 0).slice(0, 250);
    if (!elements.length) continue;
    sampledElements += elements.length;
    const sampled = dominant(elements.map((element) => ({ styles: effective(element), weight: Math.min(400, Math.max(1, $(element).text().trim().length)) })));
    if (Object.keys(sampled).length) styles[role] = sampled;
  }
  if (!styles.p || !Object.keys(styles.p).length) {
    const paragraphs = root.find('section, div').toArray().filter((element) => $(element).text().trim().length > 40 && !$(element).find('p, section, div').length).slice(0, 150);
    styles.p = dominant(paragraphs.map((element) => ({ styles: effective(element), weight: Math.min(400, $(element).text().trim().length) })));
    sampledElements += paragraphs.length;
  }
  const body = { ...styles.body, ...styles.p };
  const fontSize = Math.min(20, Math.max(14, parseFloat(body['font-size'] || '15') || 15));
  if (!styles.h2) {
    const headings = root.find('p, section').toArray().filter((element) => {
      const text = $(element).text().trim();
      if (!text || text.length > 65 || $(element).find('p, section').length) return false;
      const candidate = effective(element);
      return parseFloat(candidate['font-size'] || '0') >= fontSize + 1 && (parseInt(candidate['font-weight']) >= 600 || candidate['font-weight'] === 'bold' || $(element).find('strong, b').length > 0);
    });
    if (headings.length) styles.h2 = dominant(headings.map((element) => ({ styles: effective(element), weight: 1 })));
  }
  const accentValues = [styles.h2?.color, styles.h1?.color, styles.strong?.color, styles.a?.color, styles.blockquote?.['border-left-color'], styles.h3?.color];
  const accent = colorHex(accentValues.find(isAccent)) || colorHex(styles.h2?.color) || '#28775b';
  const channel = [1, 3, 5].map((index) => Math.round(parseInt(accent.slice(index, index + 2), 16) * 0.07 + 255 * 0.93).toString(16).padStart(2, '0'));
  let lineHeight = parseFloat(body['line-height'] || '1.9');
  if (body['line-height']?.endsWith('px')) lineHeight /= fontSize;
  if (body['line-height']?.endsWith('%')) lineHeight /= 100;
  const fontFamily = body['font-family'] || '';
  const font = /宋|楷|song|simsun|georgia|times|(?<!sans-)serif/i.test(fontFamily) ? 'serif' : 'sans';
  const detectedRoles = Object.entries(styles).filter(([, value]) => Object.keys(value).length > 0).map(([key]) => key);
  if (!detectedRoles.length) throw new AppError(422, '网页中未找到可提取的排版样式。请保存完整网页，或换一篇有正文排版的公众号文章。');
  return {
    ...builtInThemes[0], id: `custom-${randomUUID()}`, name: sourceTitle.slice(0, 12), description: '从喜欢的文章里，带回一种风格', category: '我的', custom: true,
    accent, soft: `#${channel.join('')}`, ink: colorHex(body.color) || '#3f4541', muted: '#929891', font, headingFont: font,
    fontSize, lineHeight: Math.min(2.2, Math.max(1.5, Number((Number.isFinite(lineHeight) ? lineHeight : 1.9).toFixed(2)))), paragraphSpacing: Math.min(30, Math.max(12, parseFloat(styles.p?.['margin-bottom'] || '20') || 20)),
    headingStyle: styles.h2?.['text-align'] === 'center' ? 'centered' : styles.h2?.['border-bottom'] ? 'underline' : styles.h2?.['border-left'] ? 'bar' : 'minimal',
    quoteStyle: styles.blockquote?.['background-color'] ? 'card' : 'line', sourceUrl, sourceTitle: sourceTitle.slice(0, 200), createdAt: new Date().toISOString(), styles,
    extraction: { sampledElements, detectedRoles, notes: ['提取颜色、字体及正文结构的样式；图片装饰、动态效果和外部样式表不包含在主题中。', ...(detectedRoles.length < 4 ? ['原文可识别的样式较少，未识别的部分使用清晰易读的默认排版。'] : [])] },
  };
}
