import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { Bold, Code2, Copy, Heading2, Italic, Link2, List, LoaderCircle, Quote } from 'lucide-react';

export default function Editor({ value, onChange, filename, disabled, inputRef: input, onCopy, copying }: { value: string; onChange: (value: string) => void; filename: string; disabled?: boolean; inputRef: RefObject<HTMLTextAreaElement | null>; onCopy: () => void; copying: boolean }) {
  const numbers = useRef<HTMLPreElement>(null);
  const lineNumbers = useMemo(() => Array.from({ length: value.split('\n').length }, (_, index) => String(index + 1)).join('\n'), [value]);
  const insert = (before: string, after = '', placeholder = '文字') => {
    const element = input.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const prefix = before.startsWith('\n') && (start === 0 || value[start - 1] === '\n') ? before.slice(1) : before;
    onChange(value.slice(0, start) + prefix + selected + after + value.slice(end));
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + prefix.length, start + prefix.length + selected.length); });
  };
  return <section className="editor-panel" aria-label="Markdown 编辑区"><div className="editor-panel-top"><span><Code2 size={14} /><span>Markdown</span></span><button type="button" className="editor-copy-button" title="复制当前文章的 Markdown 源文" aria-label="复制 Markdown" onClick={onCopy} disabled={disabled || copying}>{copying ? <LoaderCircle size={13} className="spin" /> : <Copy size={13} />}<span>{copying ? '复制中…' : '复制 Markdown'}</span></button></div><div className="editor-formatting"><button className="icon-button" title="二级标题" aria-label="插入二级标题" disabled={disabled} onClick={() => insert('\n## ', '', '章节标题')}><Heading2 size={16} /></button><button className="icon-button" title="粗体" aria-label="插入粗体" disabled={disabled} onClick={() => insert('**', '**')}><Bold size={15} /></button><button className="icon-button" title="斜体" aria-label="插入斜体" disabled={disabled} onClick={() => insert('*', '*')}><Italic size={15} /></button><span className="format-divider" /><button className="icon-button" title="引用" aria-label="插入引用" disabled={disabled} onClick={() => insert('\n> ', '', '值得被记住的一句话')}><Quote size={15} /></button><button className="icon-button" title="列表" aria-label="插入列表" disabled={disabled} onClick={() => insert('\n- ', '', '列表内容')}><List size={16} /></button><button className="icon-button" title="链接" aria-label="插入链接" disabled={disabled} onClick={() => insert('[', '](https://example.com)', '链接文字')}><Link2 size={15} /></button><button className="icon-button" title="代码块" aria-label="插入代码块" disabled={disabled} onClick={() => insert('\n```javascript\n', '\n```\n', '// 在这里写代码')}><Code2 size={16} /></button><span className="editor-file-hint" title={filename}>{filename}</span></div>
    <div className="editor-body"><div className="line-number-window" aria-hidden="true"><pre ref={numbers}>{lineNumbers}</pre></div><textarea ref={input} value={value} onChange={(event) => onChange(event.target.value)} onScroll={(event) => { if (numbers.current) numbers.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`; }} onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); const element = event.currentTarget; const start = element.selectionStart; onChange(value.slice(0, start) + '  ' + value.slice(element.selectionEnd)); requestAnimationFrame(() => element.setSelectionRange(start + 2, start + 2)); } }} aria-label="Markdown 编辑器" spellCheck={false} wrap="off" disabled={disabled} placeholder="# 从第一句话开始…" /></div>
  </section>;
}
