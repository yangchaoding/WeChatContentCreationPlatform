import type { ArticleSettings, Theme } from './types';

export const builtInThemes: Theme[] = [
  { id: 'forest', name: '山间来信', description: '自然清新，让阅读轻轻呼吸', category: '清新', accent: '#28775b', soft: '#f0f6f1', ink: '#35433c', muted: '#839188', font: 'sans', headingFont: 'serif', headingStyle: 'bar', quoteStyle: 'card', fontSize: 15, lineHeight: 1.9, paragraphSpacing: 20 },
  {
    // Base colors match claude.com: gray-050, clay, gray-950 and gray-150.
    id: 'claude', name: 'Claude', description: '参考 Claude 官网，暖白纸感与陶土色点缀', category: '暖调',
    accent: '#d97757', soft: '#f0eee6', ink: '#141413', muted: '#73726c',
    font: 'sans', headingFont: 'serif', headingStyle: 'underline', quoteStyle: 'card', codeStyle: 'warm',
    fontSize: 16, lineHeight: 1.9, paragraphSpacing: 22,
    styles: {
      body: { 'background-color': '#faf9f5', 'letter-spacing': '0.2px' },
      h1: { 'font-weight': '600', 'line-height': '1.5', 'letter-spacing': '0' },
      h2: { color: '#141413', 'border-bottom': '1px solid #d97757', 'font-weight': '600', 'letter-spacing': '0', 'padding-bottom': '10px' },
      h3: { color: '#3d3d3a', 'font-weight': '600', 'letter-spacing': '0' },
      strong: { color: '#9d4b35', 'font-weight': '600' },
      blockquote: { color: '#4d4c48', 'background-color': '#f0eee6', 'border-left': '3px solid #d97757', 'border-radius': '0 6px 6px 0', padding: '17px 19px' },
      a: { color: '#9d4b35' },
      code: { color: '#9d4b35', 'background-color': '#f0eee6', border: '1px solid #e8e6dc', 'letter-spacing': '0' },
      th: { color: '#3d3d3a', 'background-color': '#e8e6dc', 'border-color': '#dedcd1', 'font-weight': '600' },
      td: { 'border-color': '#dedcd1', 'vertical-align': 'top' },
      hr: { 'border-top': '1px solid #dedcd1' },
    },
  },
  {
    id: 'programming', name: '编程教程', description: '清晰步骤、深色代码，把技术讲明白', category: '编程',
    accent: '#3568d4', soft: '#eef4ff', ink: '#2b384d', muted: '#74839a',
    font: 'sans', headingFont: 'sans', headingStyle: 'bar', quoteStyle: 'card', codeStyle: 'dark',
    fontSize: 16, lineHeight: 1.85, paragraphSpacing: 20,
    styles: {
      body: { 'letter-spacing': '0.2px' },
      h1: { 'letter-spacing': '0', 'line-height': '1.45' },
      h2: { 'background-color': '#eef4ff', padding: '10px 12px', 'border-radius': '0 5px 5px 0', 'letter-spacing': '0' },
      h3: { 'letter-spacing': '0' },
      blockquote: { color: '#51627b', 'background-color': '#f3f6fc', 'border-radius': '0 5px 5px 0', padding: '15px 17px' },
      code: { border: '1px solid #dce6f6', 'letter-spacing': '0' },
      li: { 'margin-bottom': '10px' },
      th: { 'background-color': '#eef4ff', 'border-color': '#dce5f2', 'font-weight': '700' },
      td: { 'border-color': '#dce5f2', 'vertical-align': 'top' },
      hr: { 'border-top': '1px solid #dce5f2' },
    },
  },
  { id: 'ink', name: '字里行间', description: '克制留白，文字本身就有力量', category: '极简', accent: '#343d48', soft: '#f3f4f5', ink: '#3c424a', muted: '#90959b', font: 'sans', headingFont: 'sans', headingStyle: 'minimal', quoteStyle: 'line', fontSize: 15, lineHeight: 1.9, paragraphSpacing: 22 },
  { id: 'sunset', name: '日落橘子海', description: '一点暖意，给日常加点颜色', category: '温暖', accent: '#c57442', soft: '#fbf3eb', ink: '#59463c', muted: '#a59488', font: 'sans', headingFont: 'serif', headingStyle: 'underline', quoteStyle: 'card', fontSize: 15, lineHeight: 1.9, paragraphSpacing: 20 },
  { id: 'ocean', name: '深蓝来稿', description: '清晰有序，认真表达每个观点', category: '专业', accent: '#4372ac', soft: '#eef4fa', ink: '#37465a', muted: '#8a97a7', font: 'sans', headingFont: 'sans', headingStyle: 'bar', quoteStyle: 'line', fontSize: 15, lineHeight: 1.85, paragraphSpacing: 18 },
  { id: 'lavender', name: '晚风与诗', description: '柔软浪漫，收藏细小的心事', category: '文艺', accent: '#8a70a8', soft: '#f5f1f8', ink: '#514759', muted: '#a195ab', font: 'serif', headingFont: 'serif', headingStyle: 'centered', quoteStyle: 'plain', fontSize: 16, lineHeight: 2, paragraphSpacing: 24 },
  { id: 'paper', name: '旧日书页', description: '温润书卷气，像读一本好书', category: '复古', accent: '#8c7553', soft: '#f7f3eb', ink: '#514a40', muted: '#9c9282', font: 'serif', headingFont: 'serif', headingStyle: 'underline', quoteStyle: 'line', fontSize: 16, lineHeight: 2, paragraphSpacing: 22 },
  { id: 'rose', name: '玫瑰手记', description: '明亮轻盈，分享生活的可爱', category: '生活', accent: '#b77382', soft: '#fbf0f2', ink: '#59434b', muted: '#ae949d', font: 'sans', headingFont: 'serif', headingStyle: 'pill', quoteStyle: 'card', fontSize: 15, lineHeight: 1.9, paragraphSpacing: 22 },
  { id: 'bamboo', name: '青竹留白', description: '东方雅意，不疾不徐地叙述', category: '雅致', accent: '#5a807b', soft: '#eef5f3', ink: '#354b47', muted: '#8b9e99', font: 'serif', headingFont: 'serif', headingStyle: 'centered', quoteStyle: 'plain', fontSize: 16, lineHeight: 2, paragraphSpacing: 24 },
];

export function defaultSettings(theme: Theme = builtInThemes[0]): ArticleSettings {
  return { themeId: theme.id, fontSize: theme.fontSize, lineHeight: theme.lineHeight, paragraphSpacing: theme.paragraphSpacing, accent: theme.accent, font: theme.font, justify: false, showTitle: true, showMeta: true, linkFootnotes: false };
}

export const fontFamilies = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif',
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", Georgia, serif',
  mono: 'Consolas, "SFMono-Regular", Menlo, monospace',
};

export const codePalettes = {
  light: { background: '#f5f6f7', text: '#485364', comment: '#8e9a93', keyword: '#9d639e', string: '#448369', number: '#be784f', title: '#497fa1', header: '#eef1f4', label: '#607086', border: '#e0e5ec' },
  dark: { background: '#17263a', text: '#dde7f5', comment: '#9aafc4', keyword: '#c9adff', string: '#a1dfb5', number: '#f6c58d', title: '#8dcdf5', header: '#21334a', label: '#b5c6d9', border: '#30435a' },
  warm: { background: '#f0eee6', text: '#3d3d3a', comment: '#5e5d59', keyword: '#9d4b35', string: '#4b6440', number: '#98522f', title: '#5b566f', header: '#e8e6dc', label: '#5e5d59', border: '#dedcd1' },
} as const;

export function getCodePalette(style?: Theme['codeStyle']) {
  return codePalettes[style === 'dark' || style === 'warm' ? style : 'light'];
}
