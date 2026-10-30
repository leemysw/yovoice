import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Check, ChevronLeft, ChevronRight, GripVertical, Play, Undo2 } from 'lucide-react';
import { readLocal, writeLocal } from '../../shared/lib/local-store';
import { formatTime, type AlignedWord } from '../../shared/workbench';
import { estimateWords, type LyricLine } from './lyric-timing';

// 每个字最短的时长与键盘微调的步长（秒）；按住 Shift 时用细步长。整句微调的步长单独一组。
const minWord = 0.05, nudge = 0.05, fineNudge = 0.01, lineNudge = 0.1, fineLineNudge = 0.02;
// 整句调整的方式记在本机：ripple 是后面的句子跟着一起移，single 是只改这一句。
const shiftModeKey = 'yovoice-lyric-shift';
type ShiftMode = 'ripple' | 'single';
// 时间轴在这一句前后多留的秒数，方便把首尾的字往外拖；播放这一句时提前开始的秒数。
const margin = 0.6, preroll = 0.8;

// 把显示用的歌词行展开成逐字列表：没有逐字时间的行按音节均分。器乐段落没有字。
export function editableLines(lines: LyricLine[]) {
  return lines.map(line => line.instrumental ? { ...line } : { ...line, words: (line.words?.length ? line.words : estimateWords(line)).map(word => ({ ...word })) });
}
// 保存用的逐字时间：按歌词顺序列出每个字，与对齐模型的结果同一格式。
export const editedWords = (lines: LyricLine[]): AlignedWord[] => lines.flatMap(line => line.instrumental ? [] : (line.words ?? []).filter(word => word.text.trim()).map(word => ({ word: word.text.trim(), start: Math.round(word.start * 1000) / 1000, end: Math.round(word.end * 1000) / 1000 })));

// 按逐字时间重算每行的起止：一行从第一个字开始，显示到下一句开始；后面是器乐段落时唱完就收，器乐段落占住两句之间的空档。
export function retime(lines: LyricLine[], duration: number) {
  const next = lines.map(line => line.instrumental || !line.words?.length ? { ...line } : { ...line, start: line.words[0].start, end: line.words.at(-1)!.end });
  for (let i = 0; i < next.length; i++) {
    const following = next.slice(i + 1).find(line => !line.instrumental && line.words?.length)?.start ?? duration;
    if (next[i].instrumental) { next[i].start = i ? next[i - 1].end : 0; next[i].end = Math.max(next[i].start, following); }
    else if (!next[i + 1]?.instrumental) next[i].end = Math.max(next[i].end, following);
  }
  return next;
}

// 整句平移 delta 秒（第一个字的开始与后面的字一起移）。ripple 时后面所有句子跟着移；single 时只移这一句，
// 不越过前后两句，碰到时让相邻的字收短。返回调整后的歌词，平移量会被限制在可移动的范围里。
export function shiftLine(lines: LyricLine[], line: number, delta: number, mode: ShiftMode, duration: number) {
  const words = lines[line]?.words;
  if (!words?.length) return lines;
  const before = lines.slice(0, line).flatMap(entry => entry.words ?? []).at(-1);
  const after = lines.slice(line + 1).flatMap(entry => entry.words ?? [])[0];
  const moving = mode === 'ripple' ? lines.slice(line).flatMap(entry => entry.words ?? []) : words;
  const low = (before ? before.start + minWord : 0) - words[0].start;
  const high = mode === 'single' && after ? after.start - minWord - words.at(-1)!.start : Math.max(0, duration - Math.max(...moving.map(word => word.end)));
  const step = Math.max(low, Math.min(high, delta));
  if (!step) return lines;
  const moved = lines.map((entry, i) => !entry.words || i < line || (mode === 'single' && i > line) ? entry : { ...entry, words: entry.words.map(word => ({ ...word, start: word.start + step, end: Math.min(duration, word.end + step) })) });
  const first = moved[line].words![0], last = moved[line].words!.at(-1)!;
  return moved.map((entry, i) => {
    if (!entry.words?.length) return entry;
    // 前一句最后一个字唱到这一句开始为止；只改这一句时，这一句最后一个字也不压到下一句。
    if (before && entry.words.includes(before) && before.end > first.start) return { ...entry, words: entry.words.map(word => word === before ? { ...word, end: Math.max(word.start + minWord, first.start) } : word) };
    if (i === line && mode === 'single' && after && last.end > after.start) return { ...entry, words: entry.words.map((word, k) => k === entry.words!.length - 1 ? { ...word, end: Math.max(word.start + minWord, after.start) } : word) };
    return entry;
  });
}

// 改了一个字之后保持整首的字按顺序：开始不早于前一个字的开始，结束不晚于后一个字的结束，相邻的字让出重叠部分。
function settle(lines: LyricLine[], line: number, index: number, start: number, end: number, duration: number) {
  const flat = lines.flatMap((entry, i) => (entry.words ?? []).map((word, k) => ({ i, k, word })));
  const at = flat.findIndex(entry => entry.i === line && entry.k === index), prev = flat[at - 1]?.word, next = flat[at + 1]?.word;
  const low = prev ? prev.start + minWord : 0, high = next ? next.end - minWord : duration;
  start = Math.max(low, Math.min(start, high - minWord)); end = Math.max(start + minWord, Math.min(end, high));
  const changed = new Map<string, { start: number; end: number }>([[`${line}:${index}`, { start, end }]]);
  if (prev && prev.end > start) changed.set(`${flat[at - 1].i}:${flat[at - 1].k}`, { start: prev.start, end: Math.max(prev.start + minWord, start) });
  if (next && next.start < end) changed.set(`${flat[at + 1].i}:${flat[at + 1].k}`, { start: end, end: Math.max(end + minWord, next.end) });
  return lines.map((entry, i) => {
    if (!entry.words || ![...changed.keys()].some(key => key.startsWith(`${i}:`))) return entry;
    const words = entry.words.map((word, k) => changed.has(`${i}:${k}`) ? { ...word, ...changed.get(`${i}:${k}`) } : word);
    return { ...entry, words, start: words[0].start, end: Math.max(entry.end, words.at(-1)!.end) };
  });
}

// 播放页的逐字时间编辑：一次编辑一句，字块铺在时间轴上，拖动字块移动、拖两端改长短，键盘可微调；
// 也可以“跟唱打点”：边听边在每个字开始唱时按 ↓ 或回车，自动跳到下一个字和下一句。编辑结果实时显示在歌词上，保存后随版本记录。
// lines 是正在编辑的歌词（含器乐段落），line 是当前编辑的行号，由播放页持有以便同步滚动和高亮。
// lineClick 由编辑器填入：播放中点歌词里的某一句，就把这句锚定到当前播放位置；暂停时只选中这一句。
export function LyricWordEditor({ lines, setLines: setRaw, line, setLine, audio, duration, seek, play, lineClick, onSave, onCancel }: {
  lines: LyricLine[]; setLines: (lines: LyricLine[]) => void; line: number; setLine: (line: number) => void; audio: RefObject<HTMLAudioElement | null>; duration: number;
  seek: (time: number) => void; play: () => void; lineClick: RefObject<((index: number) => void) | null>; onSave: (words: AlignedWord[]) => void; onCancel: () => void;
}) {
  const setLines = (next: LyricLine[]) => setRaw(retime(next, duration));
  const [mode, setMode] = useState<ShiftMode>(() => readLocal(shiftModeKey) === 'single' ? 'single' : 'ripple');
  const chooseMode = (value: string) => { const next = value === 'single' ? 'single' : 'ripple'; setMode(next); writeLocal(shiftModeKey, next); };
  const t = useTranslator();
  const sung = lines.flatMap((entry, i) => entry.instrumental || !entry.words?.length ? [] : [i]);
  const position = Math.max(0, sung.indexOf(line)), current = lines[line];
  const words = current?.words ?? [];
  const [selected, setSelected] = useState(0);
  const [tapping, setTapping] = useState(false);
  const [history, setHistory] = useState<LyricLine[][]>([]);
  const track = useRef<HTMLElement>(null);
  const stopAt = useRef<number | null>(null);
  // 时间轴的显示范围在开始拖动时固定，拖动中不跟着字块伸缩。
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  const windowStart = view?.start ?? Math.max(0, (words[0]?.start ?? 0) - margin);
  const windowEnd = view?.end ?? Math.min(duration || Infinity, (words.at(-1)?.end ?? 0) + margin);
  const span = Math.max(.5, windowEnd - windowStart);
  const percent = (time: number) => `${(time - windowStart) / span * 100}%`;

  const commit = (next: LyricLine[]) => { setHistory(entries => [...entries.slice(-49), lines]); setLines(next); };
  const change = (index: number, start: number, end: number, record = true) => {
    const next = settle(lines, line, index, start, end, duration);
    if (record) commit(next); else setLines(next);
  };
  const shift = (delta: number, target = line) => commit(shiftLine(lines, target, delta, mode, duration));
  // 锚定：这一句从当前播放位置开始唱。
  const anchor = (target = line) => { const first = lines[target]?.words?.[0]; if (first && audio.current) shift(audio.current.currentTime - first.start, target); };
  const lineStart = words[0]?.start ?? 0;
  const stamp = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, '0')}`;
  const undo = () => { const last = history.at(-1); if (!last) return; setHistory(history.slice(0, -1)); setLines(last); };
  const goto = (next: number) => { const target = sung[Math.max(0, Math.min(sung.length - 1, next))]; if (target === undefined) return; setLine(target); setSelected(0); };
  const playLine = () => { if (!words.length) return; stopAt.current = (words.at(-1)?.end ?? 0) + .4; seek(Math.max(0, words[0].start - preroll)); play(); };
  const startTap = () => { setTapping(true); stopAt.current = null; setSelected(0); setHistory(entries => [...entries.slice(-49), lines]); seek(Math.max(0, (words[0]?.start ?? 0) - preroll * 2)); play(); };
  // 打点：选中的字从此刻开始，前一个字唱到此刻；一句打完跳到下一句，最后一个字打完结束打点。
  const tap = () => {
    const now = audio.current?.currentTime ?? 0, word = words[selected];
    if (!word) return;
    let next = settle(lines, line, selected, now, Math.max(now + minWord, word.end - word.start + now), duration);
    const prev = selected > 0 ? words[selected - 1] : null;
    if (prev) next = settle(next, line, selected - 1, prev.start, Math.max(prev.start + minWord, now), duration);
    setLines(next);
    if (selected + 1 < words.length) { setSelected(selected + 1); return; }
    if (position + 1 < sung.length) { setLine(sung[position + 1]); setSelected(0); return; }
    setTapping(false);
  };

  // 播放头逐帧跟着音频走，不经过 React 渲染；“播放这一句”唱完后自动暂停。
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const element = audio.current, box = track.current;
      if (element && box) {
        box.style.setProperty('--word-editor-head', String((element.currentTime - windowStart) / span));
        if (stopAt.current !== null && element.currentTime >= stopAt.current) { stopAt.current = null; element.pause(); }
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [audio, windowStart, span]);
  useEffect(() => {
    lineClick.current = (index: number) => {
      if (tapping || !lines[index]?.words?.length) return;
      setLine(index); setSelected(0);
      if (audio.current && !audio.current.paused) anchor(index);
    };
    return () => { lineClick.current = null; };
  });
  // 键盘：←/→ 整句提前、推后（Shift 更细），↑/↓ 换句，回车把这一句锚定到播放位置；焦点在字块上时方向键改的是那个字。
  const keys = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
    if (tapping && (event.key === 'ArrowDown' || event.key === 'Enter' && !(event.target instanceof HTMLButtonElement))) { event.preventDefault(); tap(); return; }
    if (event.key === 'Escape' && tapping) { event.preventDefault(); event.stopPropagation(); setTapping(false); return; }
    if (tapping || event.target instanceof Element && event.target.closest('.lyric-word-track, [role="radiogroup"]')) return;
    const step = event.shiftKey ? fineLineNudge : lineNudge;
    const action = event.key === 'ArrowLeft' ? () => shift(-step) : event.key === 'ArrowRight' ? () => shift(step)
      : event.key === 'ArrowUp' ? () => goto(position - 1) : event.key === 'ArrowDown' ? () => goto(position + 1)
        : event.key === 'Enter' && !(event.target instanceof HTMLButtonElement) ? () => anchor() : null;
    if (!action) return;
    event.preventDefault(); action();
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => keys(event);
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, []);

  // 拖动：mode 为 move 时整块平移，start、end 时只改一端；按下时记下原值，松开时记一步撤销。
  const drag = (event: PointerEvent<HTMLElement>, index: number, mode: 'move' | 'start' | 'end') => {
    const box = track.current, word = words[index];
    if (!box || !word || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    setSelected(index); setView({ start: windowStart, end: windowEnd });
    const origin = event.clientX, perSecond = box.getBoundingClientRect().width / span, before = lines;
    const target = event.currentTarget; target.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const delta = (moveEvent.clientX - origin) / perSecond;
      const start = mode === 'end' ? word.start : word.start + delta, end = mode === 'start' ? word.end : word.end + delta;
      setLines(settle(before, line, index, start, end, duration));
    };
    const up = () => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
      setHistory(entries => [...entries.slice(-49), before]); setView(null);
    };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  };
  const nudgeKey = (event: KeyboardEvent<HTMLElement>, index: number, mode: 'move' | 'start' | 'end') => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation();
    const word = words[index], step = (event.shiftKey ? fineNudge : nudge) * (event.key === 'ArrowLeft' ? -1 : 1);
    change(index, mode === 'end' ? word.start : word.start + step, mode === 'start' ? word.end : word.end + step);
  };
  const label = (word: string) => word.trim() || '·';
  // 刻度每 0.5 秒一格，显示整秒。
  const ticks = Array.from({ length: Math.floor(span / .5) + 2 }, (_, i) => Math.ceil(windowStart * 2) / 2 + i * .5).filter(time => time <= windowEnd);

  return <VStack className="lyric-word-editor" gap={3} role="group" aria-label={t('@yovoice.music.wordEditor')}>
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Button className="now-playing-glass now-playing-round" size="sm" variant="ghost" isIconOnly icon={<ChevronLeft />} label={t('@yovoice.music.prevLine')} tooltip={`${t('@yovoice.music.prevLine')} · ↑`} isDisabled={position <= 0 || tapping} onClick={() => goto(position - 1)} />
      <small className="lyric-word-editor-count">{t('@yovoice.music.wordLine', { n: position + 1, total: sung.length })}</small>
      <Button className="now-playing-glass now-playing-round" size="sm" variant="ghost" isIconOnly icon={<ChevronRight />} label={t('@yovoice.music.nextLine')} tooltip={`${t('@yovoice.music.nextLine')} · ↓`} isDisabled={position >= sung.length - 1 || tapping} onClick={() => goto(position + 1)} />
      <small className="lyric-word-editor-time" aria-live="polite">{stamp(lineStart)}</small>
      <HStack className="lyric-word-editor-nudge" gap={1} vAlign="center">
        <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.shiftEarlier', { n: '0.5' })} isDisabled={tapping} onClick={() => shift(-.5)} />
        <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.shiftEarlier', { n: '0.1' })} tooltip="←" isDisabled={tapping} onClick={() => shift(-lineNudge)} />
        <Button className="now-playing-mark" size="sm" variant="ghost" label={t('@yovoice.music.anchorLine')} tooltip={t('@yovoice.music.anchorLineHint')} isDisabled={tapping} onClick={() => anchor()} />
        <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.shiftLater', { n: '0.1' })} tooltip="→" isDisabled={tapping} onClick={() => shift(lineNudge)} />
        <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.shiftLater', { n: '0.5' })} isDisabled={tapping} onClick={() => shift(.5)} />
      </HStack>
      <SegmentedControl size="sm" label={t('@yovoice.music.shiftMode')} value={mode} onChange={chooseMode} isDisabled={tapping}>
        <SegmentedControlItem value="ripple" label={t('@yovoice.music.shiftRipple')} />
        <SegmentedControlItem value="single" label={t('@yovoice.music.shiftSingle')} />
      </SegmentedControl>
    </HStack>
    <VStack ref={track} className="lyric-word-track" gap={0} data-tapping={tapping || undefined}
      onPointerDown={event => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('lyric-word-tick')) { const box = event.currentTarget.getBoundingClientRect(); seek(windowStart + (event.clientX - box.left) / box.width * span); } }}>
      {ticks.map(time => <small key={time} className="lyric-word-tick" style={{ left: percent(time) }}>{Number.isInteger(time) ? formatTime(time) : ''}</small>)}
      {words.map((word, index) => <StackItem as="span" key={index} className="lyric-word-block" data-selected={index === selected || undefined} style={{ left: percent(word.start), width: `${(word.end - word.start) / span * 100}%` } as CSSProperties}>
        <Button className="lyric-word-edge" size="sm" variant="ghost" isIconOnly icon={<GripVertical />} label={t('@yovoice.music.wordStart', { word: label(word.text) })} data-edge="start" onPointerDown={event => drag(event, index, 'start')} onKeyDown={event => nudgeKey(event, index, 'start')} onFocus={() => setSelected(index)} />
        <Button className="lyric-word-body" size="sm" variant="ghost" label={label(word.text)} tooltip={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`} aria-pressed={index === selected}
          onPointerDown={event => drag(event, index, 'move')} onKeyDown={event => nudgeKey(event, index, 'move')} onFocus={() => setSelected(index)} onDoubleClick={() => { seek(Math.max(0, word.start - .3)); play(); }} />
        <Button className="lyric-word-edge" size="sm" variant="ghost" isIconOnly icon={<GripVertical />} label={t('@yovoice.music.wordEnd', { word: label(word.text) })} data-edge="end" onPointerDown={event => drag(event, index, 'end')} onKeyDown={event => nudgeKey(event, index, 'end')} onFocus={() => setSelected(index)} />
      </StackItem>)}
      <StackItem as="span" className="lyric-word-head" aria-hidden />
    </VStack>
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Button className="now-playing-glass" size="sm" variant="ghost" icon={<Play />} label={t('@yovoice.music.playLine')} isDisabled={tapping} onClick={playLine} />
      <Button className={tapping ? 'now-playing-mark' : 'now-playing-glass'} size="sm" variant="ghost" label={t(tapping ? '@yovoice.music.wordTapStop' : '@yovoice.music.wordTap')} tooltip={t('@yovoice.music.wordTapHint')} aria-pressed={tapping} onClick={() => tapping ? setTapping(false) : startTap()} />
      <small className="lyric-word-editor-hint">{t(tapping ? '@yovoice.music.wordTapHint' : '@yovoice.music.wordEditorHint')}</small>
      <Button className="now-playing-glass now-playing-round" size="sm" variant="ghost" isIconOnly icon={<Undo2 />} label={t('@yovoice.music.wordUndo')} tooltip={`${t('@yovoice.music.wordUndo')} · ⌘Z`} isDisabled={!history.length} onClick={undo} />
      <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.wordCancel')} onClick={onCancel} />
      <Button className="now-playing-mark" size="sm" variant="ghost" icon={<Check />} label={t('@yovoice.music.wordSave')} isDisabled={!history.length} onClick={() => onSave(editedWords(lines))} />
    </HStack>
  </VStack>;
}
