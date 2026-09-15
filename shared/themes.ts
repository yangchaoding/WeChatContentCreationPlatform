import type { ArticleSettings, Theme } from './types';

export const builtInThemes: Theme[] = [
  { id: 'forest', name: '山间来信', description: '自然清新，让阅读轻轻呼吸', category: '清新', accent: '#28775b', soft: '#f0f6f1', ink: '#35433c', muted: '#839188', font: 'sans', headingFont: 'serif', headingStyle: 'bar', quoteStyle: 'card', fontSize: 15, lineHeight: 1.9, paragraphSpacing: 20 },
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
};
