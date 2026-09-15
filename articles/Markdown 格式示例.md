---
title: 用 Markdown，把想法写清楚
author: 墨排
category: 格式参考 · MARKDOWN
---

# 用 Markdown，把想法写清楚

Markdown 让你用简单的标记，写出结构清晰的文章。切换到「双栏」，可以一边编辑，一边看排版效果。

## 标题与文字

正文里可以使用 **粗体强调**、*斜体*、~~删除线~~，也可以写一点 `行内代码`。

### 这是一个三级标题

建议每篇文章只有一个一级标题，用二级标题划分章节，三级标题补充细节。

## 引用与列表

> 写作不是把所有的想法都写下来，而是找到最值得表达的那一个。

无序列表：

- 观察生活，收集灵感
- 整理结构，写下初稿
  - 给文章一个清晰的开头
  - 为观点配上具体例子
- 放一放，再读一遍

有序列表：

1. 打开 Markdown 文章
2. 选择喜欢的排版主题
3. 一键复制，分享给读者

## 表格

| 元素 | Markdown 写法 | 用途 |
| --- | --- | --- |
| 二级标题 | `## 标题` | 划分章节 |
| 粗体 | `**重点**` | 强调观点 |
| 引用 | `> 句子` | 留住金句 |

## 代码

```javascript
const inspiration = {
  source: '认真生活',
  style: '真诚表达',
};

function startWriting(idea) {
  return `今天，写一点${idea}。`;
}

console.log(startWriting(inspiration.source));
```

## 链接与图片

链接的写法是 `[文字](网址)`，比如 [Markdown 语法参考](https://www.markdownguide.org/basic-syntax/)。

图片写作 `![图片说明](./images/photo.jpg)`。将图片放在文章旁的 images 文件夹里，就可以在墨排预览。发布时请在公众号中上传图片。

---

排版，是为了让表达更清楚。
