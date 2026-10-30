import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { Plus } from 'lucide-react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { formatDateTime, formatNotice } from '../../shared/i18n/format';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatTime, projectKind, type Draft, type Generation, type Track } from '../../shared/workbench';
import { Player } from './player';

// 浏览器解码不了的格式单独说明，其余按消息码显示。
export const importError = (error: unknown) => (error as Error)?.name === 'EncodingError' ? '@yovoice.error.browserDecode' : noticeMessage(error);

// 两个导入对话框只在选中目标音轨时挂载，搜索词、筛选与错误随每次打开重置。
// 对话框是模态的，会盖住全局通知，错误在框内显示。

// 从本工程的生成历史添加片段：只列出当前文本工程的整段生成。
export function HistoryImportDialog({ trackId, draft, history, append, onClose }: {
  trackId: string; draft: Draft; history: Generation[]; append: (trackId: string, source: { duration: number; generationId?: string; assetId?: string }) => void; onClose: () => void;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const matches = history.filter(g => projectKind(draft) === 'text' && !g.segment && g.settings.id === draft.id && g.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <AppDialog title={t('@yovoice.timeline.fromHistory')} closeLabel={t('@yovoice.action.close')} error={formatNotice(t, error)} onClose={onClose}>
    <TextInput label={t('@yovoice.timeline.searchHistory')} isLabelHidden placeholder={t('@yovoice.timeline.searchHistory')} value={query} onChange={setQuery} hasClear />
    <VStack className="timeline-history-list" gap={1}>
      {matches.map(g => <HStack key={g.id} gap={2} vAlign="center">
        <Button className="grow text-left" variant="ghost" label={g.title} onClick={() => {
          try { append(trackId, { generationId: g.id, duration: g.duration }); onClose(); }
          catch (error) { setError(noticeMessage(error)); }
        }} /><small className="muted">{formatTime(g.duration)} · {formatDateTime(g.createdAt, locale, 'brief')}</small>
      </HStack>)}
      {!matches.length ? <HStack className="grow timeline-history-empty" hAlign="center" vAlign="center"><p className="muted">{t('@yovoice.timeline.noHistory')}</p></HStack> : null}
    </VStack>
  </AppDialog>;
}

// 从 yovoice 其他工程的生成添加片段：按语音、音效、音乐筛选，可搜索与试听；导入由编辑器完成，失败原因在框内显示。
export function GenerationImportDialog({ trackId, draft, drafts, history, importing, importGeneration, onClose }: {
  trackId: string; draft: Draft; drafts: Draft[]; history: Generation[]; importing: boolean;
  importGeneration: (trackId: string, generation: Generation) => Promise<void>; onClose: () => void;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'text' | 'sfx' | 'music'>('sfx');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Track | null>(null);
  const generationHistory = history.flatMap(generation => {
    if (generation.segment || generation.settings.id === draft.id) return [];
    const source = drafts.find(item => item.id === generation.settings.id);
    if (!source || projectKind(source) !== kind) return [];
    const name = `${source.title} · ${generation.title}`;
    return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? [{ generation, name }] : [];
  }).sort((a, b) => b.generation.createdAt.localeCompare(a.generation.createdAt));
  const add = async (generation: Generation) => {
    if (importing) return;
    setPreview(null); setError('');
    try { await importGeneration(trackId, generation); } catch (error) { setError(importError(error)); }
  };
  return <AppDialog title={t('@yovoice.timeline.fromYovoice')} width={640} busy={importing} closeLabel={t('@yovoice.action.close')} error={formatNotice(t, error)} onClose={onClose}>
    <SegmentedControl size="sm" layout="fill" label={t('@yovoice.timeline.fromYovoice')} value={kind} onChange={value => { setPreview(null); setKind(value as typeof kind); }}>
      <SegmentedControlItem value="text" label={t('@yovoice.project.text')} />
      <SegmentedControlItem value="sfx" label={t('@yovoice.project.sfx')} />
      <SegmentedControlItem value="music" label={t('@yovoice.project.music')} />
    </SegmentedControl>
    <TextInput label={t('@yovoice.timeline.searchHistory')} isLabelHidden placeholder={t('@yovoice.timeline.searchHistory')} value={query} onChange={setQuery} hasClear />
    <VStack className="timeline-history-list" gap={1}>
      {generationHistory.map(({ generation, name }) => <HStack key={generation.id} data-generation-id={generation.id} gap={2} vAlign="center">
        <VStack className="grow timeline-generation-label" gap={0}><b title={name}>{name}</b><small className="muted">{formatTime(generation.duration)} · {formatDateTime(generation.createdAt, locale, 'brief')}</small></VStack>
        <Player inline={{ label: t('@yovoice.app.audition', { name }), select: () => setPreview({ id: generation.id, name, fileName: generation.fileName, kind: 'outputs', subtitle: '', playRequest: performance.now() }) }} track={preview?.id === generation.id ? preview : null} suspended={importing} onError={message => { setPreview(null); setError(message); }} />
        <Button size="sm" variant="secondary" icon={<Plus />} label={t('@yovoice.timeline.addGeneration')} isDisabled={importing} onClick={() => void add(generation)} />
      </HStack>)}
      {!generationHistory.length ? <HStack className="grow timeline-history-empty" hAlign="center" vAlign="center"><p className="muted">{t('@yovoice.timeline.noHistory')}</p></HStack> : null}
    </VStack>
  </AppDialog>;
}
