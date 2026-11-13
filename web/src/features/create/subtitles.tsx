import { type KeyboardEvent, type ReactNode, useEffect, lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Plus, Clock3 } from 'lucide-react';
import { Selector } from '../../shared/selector';
import { cueAudioStatus, cueGeneration, type Generation, type Character, type Draft, type SubtitleDocument } from '../../shared/workbench';
import { SubtitleParser } from './subtitle-parser';
import { fileTitle, readTextFile, subtitleAccept } from './file-import';
import { noticeMessage } from '../../shared/lib/call-error';
import { activeBinding, platform, useHotkey, useHotkeyAria, useHotkeyText, withHotkey } from '../../shared/hotkeys/hotkeys';
import { bindingText } from '../../shared/hotkeys/keys';
import { AudioCheckBadge } from '../media/audio-check';
import { joinText } from '../transcribe/caption-edit';

const SeededAvatar = lazy(() => import('../../shared/ui/seeded-avatar').then(module => ({ default: module.SeededAvatar })));

// 一行字幕的文字：高度跟随内容和栏宽，避免滚动条打断阅读；回车在光标处拆分，空行按退格或删除移除这一行；
// 给出 onJoin / onJoinNext 时，在行首按退格与上一行合并、在行尾按删除与下一行合并。语音转写的字幕编辑也用它。
// macOS 上 Ctrl+H、Ctrl+D 是系统的向前、向后删除，与退格、删除同样处理。
// 按住不放（event.repeat）时只删字，不合并、不移除整行：按住退格删到行首就停下，不会一路吞掉前面的台词。
export function CueText({ value, label, onChange, onRemove, onSplit, onJoin, onJoinNext, maxLength = 12000 }: { onSplit: (start: number, end: number) => void; onRemove: (backward: boolean) => void; onJoin?: () => void; onJoinNext?: () => void; value: string; label: string; maxLength?: number; onChange: (value: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current!;
    const resize = () => { element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`; };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) { width = element.clientWidth; resize(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return <textarea ref={input} className="subtitle-cue-text" aria-label={label} rows={1} maxLength={maxLength} value={value} onChange={e => onChange(e.target.value)} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); onSplit(event.currentTarget.selectionStart, event.currentTarget.selectionEnd); return; }
    const field = event.currentTarget, key = deleteKey(event);
    if (key && event.repeat) return;
    if (onJoin && value.trim() && key === 'Backspace' && field.selectionStart === 0 && field.selectionEnd === 0) { event.preventDefault(); onJoin(); return; }
    if (onJoinNext && value.trim() && key === 'Delete' && field.selectionStart === value.length && field.selectionEnd === value.length) { event.preventDefault(); onJoinNext(); return; }
    if (value.trim() || !key) return;
    event.preventDefault(); onRemove(key === 'Backspace');
  }} />;
}

// 按键对应的删除方向：退格向前、删除向后；macOS 上单按 Ctrl 加 H / D 同样算作退格 / 删除。其他按键为 null。
function deleteKey(event: KeyboardEvent<HTMLTextAreaElement>): 'Backspace' | 'Delete' | null {
  if (event.key === 'Backspace' || event.key === 'Delete') return event.key;
  if (platform !== 'mac' || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === 'h' ? 'Backspace' : key === 'd' ? 'Delete' : null;
}

export function SpeakerAvatar({ seed }: { seed: string }) {
  return <VStack className="subtitle-avatar" gap={0} aria-hidden="true"><Suspense fallback={null}><SeededAvatar seed={seed} /></Suspense></VStack>;
}

export function SubtitleImport({ onImport, onError, trigger }: { trigger?: (open: () => void, loading: boolean) => ReactNode; onImport: (name: string, document: SubtitleDocument) => Promise<void>; onError: (error: string) => void }) {
  const t = useTranslator();
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  return <>
    {trigger ? trigger(() => input.current?.click(), loading) : <Button size="sm" variant="secondary" label={t('@yovoice.subtitle.import')} isLoading={loading} onClick={() => input.current?.click()} />}
    <input ref={input} hidden type="file" accept={subtitleAccept} aria-label={t('@yovoice.subtitle.file')} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      setLoading(true);
      try {
        await onImport(fileTitle(file.name), new SubtitleParser().parse(file.name, await readTextFile(file, '@yovoice.subtitle.invalid')));
      } catch (error) { onError(noticeMessage(error)); }
      finally { setLoading(false); }
    }} />
  </>;
}

// 按钮提示里带上快捷键：没有生效的按键时只写名称。

// active：编辑页当前可见（页面常驻挂载、切走只隐藏），为 false 时台词快捷键不响应；台词快捷键还要求焦点在台词列表里。
// regenerate 与时间线的“重新生成”是同一个接口：传入时 story.regenerate 重新生成当前台词在时间线上对应的片段。
export function SubtitleEditor({ draft, characters, change, renderFooter, selectedCue, selectCue, history = [], playingCue = -1, failedCue, active = true, busy = false, regenerate, onError }: { history?: Generation[]; playingCue?: number; failedCue?: string; selectedCue: number; selectCue: (index: number) => void; renderFooter: (controls: ReactNode) => ReactNode; draft: Draft; characters: Character[]; change: (patch: Partial<Draft>) => void; active?: boolean; busy?: boolean; regenerate?: (cueId: string, clipId: string) => Promise<void>; onError?: (message: string) => void }) {
  const t = useTranslator();
  const [page, setPage] = useState(0);
  const editor = useRef<HTMLElement>(null);
  // 拆分、合并、插入或删除后把光标放到对应台词：position 为空时放到行尾。
  const pendingFocus = useRef<{ index: number; position?: number } | null>(null);
  const [speakerMenu, setSpeakerMenu] = useState(-1);
  const [regenerating, setRegenerating] = useState(false);
  const lastSpeaker = useRef(draft.subtitles!.cues.at(-1)?.speakerId ?? draft.subtitles!.speakers[0]?.id ?? '');
  const [showSpeakers, setShowSpeakers] = useState(false);
  const [showTimes, setShowTimes] = useState(false);
  // 台词的 id 是可选的，按位置记状态，没有 id 的台词不会互相串。
  const statuses = draft.subtitles!.cues.map(c => c.id && c.id === failedCue ? 'failed' : cueAudioStatus(draft, history, c));
  // 只在播放到的句子变化时翻到它所在的页；用户自己翻页时不拉回去。
  useEffect(() => {
    if (playingCue < 0) return;
    setPage(Math.floor(playingCue / 50));
    const id = requestAnimationFrame(() => editor.current?.querySelector(`[data-cue-index="${playingCue}"]`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [playingCue]);

  const document = draft.subtitles!;
  // 焦点所在的台词：删除、设说话人等快捷键只作用于这一句（看得见、正在编辑），焦点不在某句台词上（如翻页按钮）时为 -1。
  // 翻页后选中的台词可能已不在当前页，不能拿它当目标。
  const focusedCue = () => {
    const row = window.document.activeElement?.closest<HTMLElement>('[data-cue-index]');
    const index = row && editor.current?.contains(row) ? Number(row.dataset.cueIndex) : -1;
    return index >= 0 && index < document.cues.length ? index : -1;
  };
  // 两句说话人相同才能合并：合并后只保留前一句的说话人，不同说话人的台词合并会悄悄改掉后一句的配音。
  // 说话人按显示的算（已删掉的说话人退回第一位，与下面的头像一致）。
  const speakerOf = (index: number) => (document.speakers.find(s => s.id === document.cues[index].speakerId) ?? document.speakers[0])?.id;
  const joinable = (index: number) => !!document.cues[index + 1] && speakerOf(index) === speakerOf(index + 1);
  const update = (next: SubtitleDocument) => {
    if (next.cues.map(c => c.text).join('\n').length > 12000) return;
    change({ subtitles: next, text: next.cues.map(c => c.text).join('\n') });
  };
  const label = (index: number) => t('@yovoice.subtitle.speaker', { n: index + 1 });
  const timestamp = (ms: number) => new Date(ms).toISOString().slice(11, 23);
  const pages = Math.max(1, Math.ceil(document.cues.length / 50));
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const field = editor.current?.querySelector<HTMLTextAreaElement>(`[data-cue-index="${target.index}"] textarea`);
    if (field) {
      field.focus();
      const position = target.position ?? field.value.length;
      field.setSelectionRange(position, position);
    } else if (!document.cues.length) editor.current?.querySelector<HTMLButtonElement>('.subtitle-add-cue')?.focus();
    pendingFocus.current = null;
  }, [document.cues, page]);
  useEffect(() => { if (selectedCue >= 0) setPage(Math.floor(selectedCue / 50)); }, [selectedCue]);
  const removeCue = (index: number, backward: boolean) => {
    lastSpeaker.current = document.cues[index].speakerId;
    const cues = document.cues.filter((_, i) => i !== index);
    const next = Math.max(0, Math.min(backward ? index - 1 : index, cues.length - 1));
    pendingFocus.current = { index: next, position: backward ? undefined : 0 };
    setPage(Math.floor(next / 50)); selectCue(next);
    update({ ...document, cues });
  };
  // 把第 index 句与下一句合并，光标放在两句的接缝处：行首退格合并上一句、行尾删除合并下一句都用它（与转写编辑一致）。
  // 合并后沿用前一句的 id、说话人和演绎，时间取两句的首尾。
  const joinCue = (index: number) => {
    const a = document.cues[index], b = document.cues[index + 1];
    if (!a || !b) return;
    const text = joinText(a.text, b.text);
    pendingFocus.current = { index, position: text.length - b.text.trim().length };
    setPage(Math.floor(index / 50)); selectCue(index);
    update({ ...document, cues: [...document.cues.slice(0, index), { ...a, text, end: Math.max(a.end, b.end) }, ...document.cues.slice(index + 2)] });
  };
  // 在第 index 句下方插入一句空台词并聚焦，说话人沿用这一句。
  const full = document.cues.length >= 2000 || draft.text.length >= 12000;
  const insertCue = (index: number) => {
    const cue = document.cues[index];
    if (!cue || full) return;
    const start = Math.min(cue.end, 86399999);
    pendingFocus.current = { index: index + 1, position: 0 };
    update({ ...document, cues: [...document.cues.slice(0, index + 1), { id: crypto.randomUUID(), start, end: Math.min(start + 2000, 86400000), text: '', speakerId: cue.speakerId }, ...document.cues.slice(index + 1)] });
    setPage(Math.floor((index + 1) / 50)); selectCue(index + 1);
  };
  // 换说话人时清掉这句的演绎快照：快照是按原说话人的参数做的。
  const setSpeaker = (index: number, speakerId: string) => update({ ...document, cues: document.cues.map((c, j) => j === index ? { ...c, speakerId, performance: speakerId === c.speakerId ? c.performance : undefined } : c) });
  // 焦点移到第 index 句的输入框（光标放行尾），不在当前页时先翻页。
  const focusCue = (index: number) => {
    if (index < 0 || index >= document.cues.length) return;
    const field = editor.current?.querySelector<HTMLTextAreaElement>(`[data-cue-index="${index}"] textarea`);
    if (field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); field.closest('[data-cue-index]')?.scrollIntoView({ block: 'nearest' }); return; }
    pendingFocus.current = { index };
    setPage(Math.floor(index / 50)); selectCue(index);
  };
  const turnPage = (next: number) => {
    if (next < 0 || next >= pages || next === page) return;
    pendingFocus.current = { index: next * 50, position: 0 };
    setPage(next); selectCue(next * 50);
  };
  // 当前台词在时间线上对应的片段（锁定音轨里的不算），重新生成时替换它；还没生成过的台词没有片段。
  const selected = document.cues[selectedCue];
  const regenerateTarget = (() => {
    if (!regenerate || !selected?.id || !selected.text.trim()) return undefined;
    const ids = new Set(history.filter(g => g.segment?.cueId === selected.id).map(g => g.id));
    const clip = draft.timeline?.tracks.filter(lane => !lane.locked).flatMap(lane => lane.clips).find(c => c.generationId && ids.has(c.generationId));
    return clip ? { cueId: selected.id, clipId: clip.id } : undefined;
  })();
  const regenerateCue = async () => {
    if (!regenerate || !regenerateTarget || busy || regenerating) return;
    setRegenerating(true);
    try { await regenerate(regenerateTarget.cueId, regenerateTarget.clipId); } catch (error) { onError?.(noticeMessage(error)); } finally { setRegenerating(false); }
  };
  const within = { within: editor, enabled: active && document.cues.length > 0 };
  useHotkey('story.regenerate', () => { if (focusedCue() === selectedCue) void regenerateCue(); }, { ...within, enabled: within.enabled && !!regenerateTarget && !busy && !regenerating });
  // 上下一句从焦点所在的台词算起，焦点不在台词上时从选中的那句算起。
  const current = () => { const index = focusedCue(); return index >= 0 ? index : selectedCue; };
  useHotkey('story.prevCue', () => focusCue(current() - 1), { ...within, repeat: true });
  useHotkey('story.nextCue', () => focusCue(current() + 1), { ...within, repeat: true });
  useHotkey('story.insert', () => { const index = focusedCue(); if (index >= 0) insertCue(index); }, { ...within, enabled: within.enabled && !full });
  useHotkey('story.deleteCue', () => { const index = focusedCue(); if (index >= 0) removeCue(index, false); }, within);
  useHotkey('story.prevPage', () => turnPage(page - 1), { ...within, enabled: within.enabled && page > 0 });
  useHotkey('story.nextPage', () => turnPage(page + 1), { ...within, enabled: within.enabled && page + 1 < pages });
  useHotkey('story.speaker', (_, number) => { const speaker = number === undefined ? undefined : document.speakers[number], index = focusedCue(); if (speaker && index >= 0) setSpeaker(index, speaker.id); }, within);
  useHotkey('story.speakerMenu', () => { const index = focusedCue(); if (index >= 0) setSpeakerMenu(index); }, { ...within, enabled: within.enabled && document.speakers.length > 0 });
  const speakerMenuKeys = useHotkeyText('story.speakerMenu'), speakerMenuAria = useHotkeyAria('story.speakerMenu');
  // 说话人菜单里第 n 位的按键（⌥1 …）：story.speaker 是数字组合，按位置换成具体数字。
  const speakerBinding = useHotkeyText('story.speaker') ? activeBinding('story.speaker') : '';
  const speakerKeys = (index: number) => speakerBinding && index < 9 ? bindingText(speakerBinding.replace('#', String(index + 1)), platform) : undefined;
  const prevPageKeys = useHotkeyText('story.prevPage'), nextPageKeys = useHotkeyText('story.nextPage');
  const prevPageAria = useHotkeyAria('story.prevPage'), nextPageAria = useHotkeyAria('story.nextPage');
  return <><VStack ref={editor} className="subtitle-editor" gap={2}>
    {showSpeakers ? <AppDialog title={t('@yovoice.subtitle.settings')} width={520} onClose={() => setShowSpeakers(false)} closeLabel={t('@yovoice.action.cancel')} actions={<Button size="sm" variant="ghost" icon={<Plus />} label={t('@yovoice.subtitle.addSpeaker')} isDisabled={document.speakers.length >= 100} onClick={() => update({ ...document, speakers: [...document.speakers, { id: crypto.randomUUID(), sourceName: '' }] })} />}>

      <VStack gap={0}>

        {document.speakers.map((speaker, index) => <HStack key={speaker.id} className="subtitle-speaker-row" gap={3} vAlign="end">
          <SpeakerAvatar seed={speaker.characterId ?? `${draft.id}:${speaker.id}`} />
          <VStack gap={0} className="subtitle-speaker-name"><TextInput size="sm" label={label(index)} isLabelHidden placeholder={label(index)} aria-label={t('@yovoice.subtitle.roleName')} value={speaker.sourceName} onChange={sourceName => update({ ...document, speakers: document.speakers.map(s => s.id === speaker.id ? { ...s, sourceName: sourceName.slice(0, 120) } : s) })} /></VStack>
          <Selector size="sm" label={`${label(index)}${speaker.sourceName ? ` (${speaker.sourceName})` : ''}`} isLabelHidden width="100%" value={speaker.characterId ?? ''}
            options={[{ value: '', label: t(speaker.settings && !speaker.characterId ? '@yovoice.subtitle.customSettings' : '@yovoice.subtitle.currentSettings') }, ...characters.map(c => ({ value: c.id, label: c.name })), ...(speaker.characterId && !characters.some(c => c.id === speaker.characterId) ? [{ value: speaker.characterId, label: t('@yovoice.subtitle.savedCharacter') }] : [])]}
            onChange={id => {
              const character = characters.find(c => c.id === id);
              if (id && !character) return;
              update({ ...document, cues: document.cues.map(c => c.speakerId === speaker.id ? { ...c, performance: undefined } : c), speakers: document.speakers.map(s => s.id === speaker.id ? { ...s, characterId: id || undefined, settings: character ? structuredClone(character.settings) : undefined } : s) });
            }} />
        </HStack>)}
      </VStack>
    </AppDialog> : null}
    <VStack gap={1}>
      {document.cues.slice(page * 50, (page + 1) * 50).map((cue, offset) => {
        const index = page * 50 + offset;
        // 说话人被删掉或数据不一致时退回第一位说话人，头像按台词自己的说话人 id 取种子。
        const speaker = document.speakers.find(s => s.id === cue.speakerId) ?? document.speakers[0];
        const status = statuses[index];
        return <HStack key={cue.id ?? index} data-cue-index={index} className="subtitle-cue" data-selected={selectedCue === index} data-playing={playingCue === index} onFocusCapture={() => selectCue(index)} onClick={() => selectCue(index)} gap={3} vAlign="start">
          <DropdownMenu presentation="popover" hasChevron={false} menuWidth="max-content" isMenuOpen={speakerMenu === index} onOpenChange={open => setSpeakerMenu(open ? index : current => current === index ? -1 : current)}
            button={{ size: 'sm', variant: 'ghost', isIconOnly: true, className: 'subtitle-speaker-trigger', label: t('@yovoice.subtitle.lineSpeaker', { n: index + 1 }), tooltip: withHotkey(t('@yovoice.subtitle.lineSpeaker', { n: index + 1 }), speakerMenuKeys), 'aria-keyshortcuts': selectedCue === index ? speakerMenuAria : undefined, icon: <SpeakerAvatar seed={speaker?.characterId ?? `${draft.id}:${speaker?.id ?? cue.speakerId}`} /> }}
            items={document.speakers.map((s, i) => ({ id: s.id, label: label(i), description: s.sourceName || undefined, endContent: speakerKeys(i), icon: <SpeakerAvatar seed={s.characterId ?? `${draft.id}:${s.id}`} />, onClick: () => setSpeaker(index, s.id) }))} />
          {cue.text.trim() && status !== 'ready' ? <i className="cue-audio-status" data-status={status} role="img" aria-label={t(`@yovoice.timeline.${status}Cue`)} title={t(`@yovoice.timeline.${status}Cue`)} /> : null}
          {status === 'ready' ? <AudioCheckBadge className="cue-audio-check" check={cueGeneration(draft, history, cue)?.check} /> : null}
          <VStack gap={0} className="grow">
            {showTimes ? <small className="subtitle-time">{timestamp(cue.start)} – {timestamp(cue.end)}</small> : null}
            <CueText onSplit={(start, end) => {
              if (full) return;
              const cues = [...document.cues];
              cues.splice(index, 1, { ...cue, text: cue.text.slice(0, start) }, { ...cue, id: crypto.randomUUID(), text: cue.text.slice(end) });
              pendingFocus.current = { index: index + 1, position: 0 };
              setPage(Math.floor((index + 1) / 50)); selectCue(index + 1); update({ ...document, cues });
            }} onJoin={index > 0 && joinable(index - 1) ? () => joinCue(index - 1) : undefined} onJoinNext={joinable(index) ? () => joinCue(index) : undefined} onRemove={backward => removeCue(index, backward)} label={t('@yovoice.subtitle.lineText', { n: index + 1 })} value={cue.text} onChange={text => update({ ...document, cues: document.cues.map((c, i) => i === index ? { ...c, text } : c) })} />
          </VStack>
        </HStack>;
      })}
    </VStack>
    {page === pages - 1 ? <Button className="subtitle-add-cue" variant="ghost" label={t('@yovoice.subtitle.addCue')} isDisabled={full} onClick={() => {
      const previous = document.cues.at(-1);
      const index = document.cues.length;
      const start = Math.min(previous?.end ?? 0, 86399999);
      pendingFocus.current = { index, position: 0 };
      update({ ...document, cues: [...document.cues, { id: crypto.randomUUID(), start, end: Math.min(start + 2000, 86400000), text: '', speakerId: previous?.speakerId ?? lastSpeaker.current }] });
      setPage(Math.floor(index / 50)); selectCue(index);
    }} /> : null}
    {pages > 1 ? <HStack gap={3} vAlign="center" hAlign="end"><Button size="sm" variant="ghost" label={t('@yovoice.subtitle.previous')} tooltip={prevPageKeys ? withHotkey(t('@yovoice.subtitle.previous'), prevPageKeys) : undefined} aria-keyshortcuts={prevPageAria} isDisabled={page === 0} onClick={() => turnPage(page - 1)} /><small>{page + 1} / {pages}</small><Button size="sm" variant="ghost" label={t('@yovoice.subtitle.next')} tooltip={nextPageKeys ? withHotkey(t('@yovoice.subtitle.next'), nextPageKeys) : undefined} aria-keyshortcuts={nextPageAria} isDisabled={page + 1 >= pages} onClick={() => turnPage(page + 1)} /></HStack> : null}
  </VStack>
  {renderFooter(<HStack gap={2} vAlign="center">
      <Button size="sm" variant="secondary" label={t('@yovoice.subtitle.settings')} onClick={() => setShowSpeakers(true)} />
      <Button size="sm" variant="ghost" isIconOnly icon={<Clock3 />} label={t(showTimes ? '@yovoice.subtitle.hideTimes' : '@yovoice.subtitle.showTimes')} aria-pressed={showTimes} onClick={() => setShowTimes(!showTimes)} />
    </HStack>)}
  </>;
}
