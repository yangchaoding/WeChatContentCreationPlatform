const collator = new Intl.Collator('zh-CN', { numeric: true });
const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const numeral = '[零〇一二两三四五六七八九十百千万]+';
const ordinal = new RegExp(`^(\\s*(?:第\\s*|(?:阶段|章节|模块|单元|课程|步骤|部分)\\s*))(${numeral})(?=$|[\\s、，,：:._\\-）)]|章|节|课|讲|篇|部|卷|期|阶段|单元|模块)`);
const numbered = new RegExp(`^(\\s*[（(]?\\s*)(${numeral})(?=\\s*[、，,：:.．）)])`);

function chineseNumber(value: string): number {
  if (![...value].some((character) => character in units || character === '万')) return Number([...value].map((character) => digits[character]).join(''));
  let total = 0, section = 0, digit = 0;
  for (const character of value) {
    if (character in digits) digit = digits[character];
    else if (character === '万') { total += (section + digit || 1) * 10000; section = 0; digit = 0; }
    else { section += (digit || 1) * units[character]; digit = 0; }
  }
  return total + section + digit;
}

function sortKey(name: string): string {
  // Only explicit numbering is numeric; ordinary names such as 三体 stay intact.
  return name.replace(ordinal, (_match, prefix: string, number: string) => `${prefix}${chineseNumber(number)}`)
    .replace(numbered, (_match, prefix: string, number: string) => `${prefix}${chineseNumber(number)}`);
}

/** Natural name order, including Chinese stage/chapter numbers. */
export function compareNames(a: string, b: string): number {
  return collator.compare(sortKey(a), sortKey(b)) || collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
