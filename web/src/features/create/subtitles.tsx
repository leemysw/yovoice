import { type ReactNode, useEffect, lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
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
import { AudioCheckBadge } from '../media/audio-check';

const SeededAvatar = lazy(() => import('../../shared/ui/seeded-avatar').then(module => ({ default: module.SeededAvatar })));

// 台词高度跟随内容和栏宽，避免滚动条与拖动手柄打断阅读。
function CueText({ value, label, onChange, onRemove, onSplit }: { onSplit: (start: number, end: number) => void; onRemove: (backward: boolean) => void; value: string; label: string; onChange: (value: string) => void }) {
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
  return <textarea ref={input} className="subtitle-cue-text" aria-label={label} rows={1} maxLength={12000} value={value} onChange={e => onChange(e.target.value)} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); onSplit(event.currentTarget.selectionStart, event.currentTarget.selectionEnd); return; }
    if (value.trim() || !['Backspace', 'Delete'].includes(event.key)) return;
    event.preventDefault(); onRemove(event.key === 'Backspace');
  }} />;
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

export function SubtitleEditor({ draft, characters, change, renderFooter, selectedCue, selectCue, history = [], playingCue = -1, failedCue }: { history?: Generation[]; playingCue?: number; failedCue?: string; selectedCue: number; selectCue: (index: number) => void; renderFooter: (controls: ReactNode) => ReactNode; draft: Draft; characters: Character[]; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  const [page, setPage] = useState(0);
  const editor = useRef<HTMLElement>(null);
  const pendingFocus = useRef<{ index: number; end: boolean } | null>(null);
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
      const position = target.end ? field.value.length : 0;
      field.setSelectionRange(position, position);
    } else if (!document.cues.length) editor.current?.querySelector<HTMLButtonElement>('.subtitle-add-cue')?.focus();
    pendingFocus.current = null;
  }, [document.cues, page]);
  useEffect(() => { if (selectedCue >= 0) setPage(Math.floor(selectedCue / 50)); }, [selectedCue]);
  const removeCue = (index: number, backward: boolean) => {
    lastSpeaker.current = document.cues[index].speakerId;
    const cues = document.cues.filter((_, i) => i !== index);
    const next = Math.max(0, Math.min(backward ? index - 1 : index, cues.length - 1));
    pendingFocus.current = { index: next, end: backward };
    setPage(Math.floor(next / 50)); selectCue(next);
    update({ ...document, cues });
  };
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
          <DropdownMenu presentation="popover" hasChevron={false} menuWidth="max-content" button={{ size: 'sm', variant: 'ghost', isIconOnly: true, className: 'subtitle-speaker-trigger', label: t('@yovoice.subtitle.lineSpeaker', { n: index + 1 }), icon: <SpeakerAvatar seed={speaker?.characterId ?? `${draft.id}:${speaker?.id ?? cue.speakerId}`} /> }} items={document.speakers.map((s, i) => ({ id: s.id, label: label(i), description: s.sourceName || undefined, icon: <SpeakerAvatar seed={s.characterId ?? `${draft.id}:${s.id}`} />, onClick: () => update({ ...document, cues: document.cues.map((c, j) => j === index ? { ...c, speakerId: s.id, performance: s.id === c.speakerId ? c.performance : undefined } : c) }) }))} />
          {cue.text.trim() && status !== 'ready' ? <i className="cue-audio-status" data-status={status} role="img" aria-label={t(`@yovoice.timeline.${status}Cue`)} title={t(`@yovoice.timeline.${status}Cue`)} /> : null}
          {status === 'ready' ? <AudioCheckBadge className="cue-audio-check" check={cueGeneration(draft, history, cue)?.check} /> : null}
          <VStack gap={0} className="grow">
            {showTimes ? <small className="subtitle-time">{timestamp(cue.start)} – {timestamp(cue.end)}</small> : null}
            <CueText onSplit={(start, end) => {
              if (document.cues.length >= 2000 || draft.text.length >= 12000) return;
              const cues = [...document.cues];
              cues.splice(index, 1, { ...cue, text: cue.text.slice(0, start) }, { ...cue, id: crypto.randomUUID(), text: cue.text.slice(end) });
              pendingFocus.current = { index: index + 1, end: false };
              setPage(Math.floor((index + 1) / 50)); selectCue(index + 1); update({ ...document, cues });
            }} onRemove={backward => removeCue(index, backward)} label={t('@yovoice.subtitle.lineText', { n: index + 1 })} value={cue.text} onChange={text => update({ ...document, cues: document.cues.map((c, i) => i === index ? { ...c, text } : c) })} />
          </VStack>
        </HStack>;
      })}
    </VStack>
    {page === pages - 1 ? <Button className="subtitle-add-cue" variant="ghost" label={t('@yovoice.subtitle.addCue')} isDisabled={document.cues.length >= 2000 || draft.text.length >= 12000} onClick={() => {
      const previous = document.cues.at(-1);
      const index = document.cues.length;
      const start = Math.min(previous?.end ?? 0, 86399999);
      pendingFocus.current = { index, end: false };
      update({ ...document, cues: [...document.cues, { id: crypto.randomUUID(), start, end: Math.min(start + 2000, 86400000), text: '', speakerId: previous?.speakerId ?? lastSpeaker.current }] });
      setPage(Math.floor(index / 50)); selectCue(index);
    }} /> : null}
    {pages > 1 ? <HStack gap={3} vAlign="center" hAlign="end"><Button size="sm" variant="ghost" label={t('@yovoice.subtitle.previous')} isDisabled={page === 0} onClick={() => setPage(page - 1)} /><small>{page + 1} / {pages}</small><Button size="sm" variant="ghost" label={t('@yovoice.subtitle.next')} isDisabled={page + 1 >= pages} onClick={() => setPage(page + 1)} /></HStack> : null}
  </VStack>
  {renderFooter(<HStack gap={2} vAlign="center">
      <Button size="sm" variant="secondary" label={t('@yovoice.subtitle.settings')} onClick={() => setShowSpeakers(true)} />
      <Button size="sm" variant="ghost" isIconOnly icon={<Clock3 />} label={t(showTimes ? '@yovoice.subtitle.hideTimes' : '@yovoice.subtitle.showTimes')} aria-pressed={showTimes} onClick={() => setShowTimes(!showTimes)} />
    </HStack>)}
  </>;
}
