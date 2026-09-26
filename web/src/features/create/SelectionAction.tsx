import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Type } from 'lucide-react';

export interface TextSelection { start: number; end: number; word: string }
interface SelectionAnchor extends TextSelection { rect: DOMRect; bounds: DOMRect }

function measureSelection(editor: HTMLTextAreaElement): SelectionAnchor | null {
  const { selectionStart: start, selectionEnd: end } = editor;
  const word = editor.value.slice(start, end);
  if (!word.trim()) return null;
  const bounds = editor.getBoundingClientRect();
  const viewport = editor.closest('.document')!.getBoundingClientRect();
  const style = getComputedStyle(editor);
  // textarea 不提供选区坐标，用同排版的不可见文本测量；不改变原编辑器和选区。
  const mirror = document.createElement('div');
  for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'tab-size', 'padding', 'border', 'direction', 'word-break']) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, {
    position: 'fixed', visibility: 'hidden', pointerEvents: 'none', boxSizing: 'border-box',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    width: `${editor.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`,
    left: `${bounds.left - editor.scrollLeft}px`, top: `${bounds.top - editor.scrollTop}px`,
  });
  mirror.textContent = editor.value;
  document.body.append(mirror);
  try {
    const range = document.createRange();
    range.setStart(mirror.firstChild!, start); range.setEnd(mirror.firstChild!, end);
    const top = Math.max(bounds.top, viewport.top, 0);
    const bottom = Math.min(bounds.bottom, viewport.bottom, innerHeight);
    const rect = Array.from(range.getClientRects()).find(r => r.width > 0 && r.top >= top && r.bottom <= bottom);
    return rect ? { start, end, word, rect, bounds: viewport } : null;
  } finally { mirror.remove(); }
}

export function SelectionAction({ editor, onEdit }: { editor: RefObject<HTMLTextAreaElement | null>; onEdit: (selection: TextSelection) => void }) {
  const t = useTranslator();
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const popup = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!selection || !popup.current) return;
    const { width, height } = popup.current.getBoundingClientRect();
    const { rect, bounds } = selection;
    const gap = 8;
    const left = Math.max(bounds.left + gap, Math.min((rect.left + rect.right - width) / 2, bounds.right - width - gap));
    const top = rect.top - height - gap >= bounds.top ? rect.top - height - gap : rect.bottom + gap;
    setPosition({ left, top: Math.max(gap, Math.min(top, innerHeight - height - gap)) });
    button.current = popup.current.querySelector('button');
  }, [selection]);
  useEffect(() => {
    const target = editor.current;
    if (!target) return;
    let dragging = false;
    const hide = () => setSelection(null);
    const refresh = () => {
      if (!dragging && document.activeElement === target) setSelection(measureSelection(target));
    };
    const down = (event: PointerEvent) => {
      if (event.target === target) { dragging = true; hide(); }
      else if (!popup.current?.contains(event.target as Node)) hide();
    };
    const up = () => { if (dragging) { dragging = false; refresh(); } };
    const blur = (event: FocusEvent) => { if (!popup.current?.contains(event.relatedTarget as Node)) hide(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { hide(); return; }
      if (event.key === 'Tab' && !event.shiftKey && popup.current) { event.preventDefault(); button.current?.focus(); }
    };
    document.addEventListener('selectionchange', refresh);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    target.addEventListener('blur', blur);
    target.addEventListener('keydown', keydown);
    target.addEventListener('input', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('selectionchange', refresh);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      target.removeEventListener('blur', blur);
      target.removeEventListener('keydown', keydown);
      target.removeEventListener('input', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [editor]);
  if (!selection) return null;
  return <HStack as="aside" ref={popup} className="selection-action" aria-label={t('@yovoice.selection.aria')} style={position}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setSelection(null); }}
    onKeyDown={event => { if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey)) { event.preventDefault(); setSelection(null); editor.current?.focus(); } }}>
    {/* WebKit 点击按钮时可能不转移焦点，阻止鼠标按下导致编辑器失焦并提前卸载浮层。 */}
    <Button label={t('@yovoice.selection.adjustPronunciation')} icon={<Type size={16} />} size="sm" variant="secondary"
      onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}
      onClick={() => { const target = editor.current; if (target) { const start = target.selectionStart; const end = target.selectionEnd; const word = target.value.slice(start, end); if (word.trim()) onEdit({ start, end, word }); } setSelection(null); }} />
  </HStack>;
}
