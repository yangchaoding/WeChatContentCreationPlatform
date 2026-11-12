import { describe, expect, it } from 'vitest';
import { compareNames } from '../shared/name-order';

describe('natural Chinese article and directory order', () => {
  it('sorts the actual course stages by number, including later two-digit stages', () => {
    const stages = ['阶段十：综合项目', '阶段二：计算机与开发工具基础', '阶段六：AI Agent 核心技术', '阶段四：AI - 机器学习基础概念', '阶段五：大语言模型与 Prompt Engineering', '阶段一：Python编程基础', '阶段十一：进阶'];
    expect(stages.sort(compareNames)).toEqual(['阶段一：Python编程基础', '阶段二：计算机与开发工具基础', '阶段四：AI - 机器学习基础概念', '阶段五：大语言模型与 Prompt Engineering', '阶段六：AI Agent 核心技术', '阶段十：综合项目', '阶段十一：进阶']);
  });
  it('understands chapter, module, and leading Chinese outline numbers', () => {
    for (const [prefix, suffix] of [['第', '章 Python.md'], ['第', '阶段：学习'], ['模块', '：练习'], ['', '、笔记.md'], ['（', '）课程']]) {
      const numbers = ['一', '二', '九', '十', '十一', '二十', '二十一', '九十九', '一百', '一百零二', '一百一十', '两百', '一千', '一万', '一万零一'];
      const expected = numbers.map((number) => `${prefix}${number}${suffix}`);
      expect([...expected].reverse().sort(compareNames)).toEqual(expected);
    }
  });
  it('keeps Arabic natural order and orders mixed stage numbering consistently', () => {
    expect(['1.10_ 异常处理.md', '1.2_ 字符串.md', '1.1_ 变量.md'].sort(compareNames)).toEqual(['1.1_ 变量.md', '1.2_ 字符串.md', '1.10_ 异常处理.md']);
    expect(['阶段10：项目', '阶段二：基础', '阶段一：入门', '阶段3：进阶'].sort(compareNames)).toEqual(['阶段一：入门', '阶段二：基础', '阶段3：进阶', '阶段10：项目']);
  });
  it('keeps normal Chinese names as text and gives equivalent numbers a stable tie-break', () => {
    const names = ['三体阅读', '一心一意', '二手资料', '一加手机', '十一月随笔', '第三方工具', '第一性原理'];
    const collator = new Intl.Collator('zh-CN', { numeric: true });
    expect([...names].sort(compareNames)).toEqual([...names].sort(collator.compare));
    const equivalents = ['阶段二：练习', '阶段2：练习', '阶段02：练习', '阶段两：练习'];
    expect([...equivalents].sort(compareNames)).toEqual([...equivalents].reverse().sort(compareNames));
    expect(compareNames('阶段二：练习', '阶段二：练习')).toBe(0);
  });
});
