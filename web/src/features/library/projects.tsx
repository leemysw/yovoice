import { useRef, useState, type ReactNode, type ComponentProps } from 'react';
import { formatNotice } from '../../shared/i18n/format';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Layout';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AudioWaveform, Copy, FileMusic, FileText, FolderInput, History, Mic, MoreHorizontal, Music, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { createDraft, formatTime, projectKind, type Draft, type Feature, type UiLocale } from '../../shared/workbench';
import { call, isDesktop } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { SpeakerAvatar } from '../create/subtitles';
import { importAccept, readImport } from '../create/file-import';
import { createMusicDraft } from '../music/music-draft';
import { createScoreDraft, scoreDuration } from '../score/score-draft';
import { createSfxDraft } from '../sfx/sfx-draft';
import { RecordCover } from './record-cover';
import { LibraryEmpty, LibraryPage, Ticket } from './library-layout';
import { TapeCover } from './tape-cover';
import { WaveRing } from './wave-ring';
import { overflowTitle } from '../../shared/ui/overflow-title';

export function NewProject({ locale, modelId, modelFor, create, onError, button, kind, hidden = [] }: {
  kind?: 'text' | 'story' | 'music' | 'score' | 'sfx'; locale: UiLocale; modelId?: string;
  // 在设置中隐藏的功能不出现在新建菜单里；编曲与音效随音乐生成一起隐藏。
  hidden?: Feature[];
  // 按作品类型给出默认模型（优先已下载的），不给时用各类型的内置默认。
  modelFor?: (kind: 'text' | 'story' | 'music' | 'score' | 'sfx') => string; create: (draft: Draft) => Promise<void>; onError: (error: string) => void;
  button?: Omit<ComponentProps<typeof Button>, 'onClick' | 'label'> & { label?: string };
}) {
  const t = useTranslator();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // 导入文本或字幕后直接进入对应作品，沿用当前默认模型配音。
  async function importFile(file: File) {
    setBusy(true);
    try {
      const imported = await readImport(file);
      const base = { ...createDraft(false, locale, modelId), title: imported.title };
      await create(imported.kind === 'text' ? { ...base, kind: 'text', text: imported.text }
        : { ...base, kind: 'story', text: imported.subtitles.cues.map(c => c.text).join('\n'), subtitles: imported.subtitles });
    } catch (error) { onError(noticeMessage(error)); }
    finally { setBusy(false); }
  }
  async function start(kind: 'text' | 'story' | 'music' | 'score' | 'sfx') {
    setBusy(true);
    const base: Draft = kind === 'music' ? createMusicDraft(locale, false) : kind === 'score' ? createScoreDraft(locale, false) : kind === 'sfx' ? createSfxDraft(locale) : { ...createDraft(false, locale, modelId), kind };
    const next: Draft = modelFor ? { ...base, modelId: modelFor(kind) } : base;
    if (kind === 'story') next.subtitles = { speakers: [{ id: crypto.randomUUID(), sourceName: t('@yovoice.library.narrator') }], cues: [] };
    try { await create(next); }
    catch (error) { onError(noticeMessage(error)); }
    finally { setBusy(false); }
  }
  if (kind) return <Button label={t(`@yovoice.project.new.${kind}`)} icon={<Plus />} size="sm" {...button} isLoading={busy} onClick={() => void start(kind)} />;
  return <><DropdownMenu data-testid={button?.['data-testid']} presentation="popover" hasChevron={false}
    button={{ label: t('@yovoice.project.new'), icon: <Plus />, size: 'sm', ...button, isLoading: busy }}
    items={[
      // 图标与侧栏导航一致。
      { id: 'text', label: t('@yovoice.project.text'), icon: <Mic className="project-menu-icon" strokeWidth={1.5} />, onClick: () => void start('text') },
      ...(hidden.includes('story') ? [] : [{ id: 'story', label: t('@yovoice.project.story'), icon: <Pencil className="project-menu-icon" strokeWidth={1.5} />, onClick: () => void start('story') }]),
      ...(hidden.includes('music') ? [] : [
        { id: 'music', label: t('@yovoice.project.music'), icon: <Music className="project-menu-icon" strokeWidth={1.5} />, onClick: () => void start('music') },
        { id: 'score', label: t('@yovoice.project.score'), icon: <FileMusic className="project-menu-icon" strokeWidth={1.5} />, onClick: () => void start('score') },
        { id: 'sfx', label: t('@yovoice.project.sfx'), icon: <AudioWaveform className="project-menu-icon" strokeWidth={1.5} />, onClick: () => void start('sfx') },
      ]),
      { id: 'file', label: t('@yovoice.import.file'), icon: <FileText className="project-menu-icon" strokeWidth={1.5} />, onClick: () => fileInput.current?.click() },
      ...(isDesktop ? [{ id: 'import', label: t('@yovoice.timeline.importProject'), icon: <FolderInput className="project-menu-icon" strokeWidth={1.5} />, onClick: () => { setBusy(true); void call<Draft | null>('project.import').then(d => d ? create(d) : undefined).catch(e => onError(noticeMessage(e))).finally(() => setBusy(false)); } }] : []),
    ]} />
    <input ref={fileInput} hidden type="file" accept={importAccept} aria-label={t('@yovoice.import.file')} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void importFile(file);
    }} />
  </>;
}

export function Projects({ drafts, kind, title, controls, open, create, copy, save, remove, history, onError }: { onError: (error: string) => void;
  drafts: Draft[]; kind: 'text' | 'story' | 'music' | 'score' | 'sfx'; title?: string; controls?: ReactNode; open: (draft: Draft) => void; create: ReactNode;
  history: (draft: Draft) => void; copy: (draft: Draft) => void; save: (draft: Draft) => Promise<void>; remove: (draft: Draft) => void;
}) {
  const t = useTranslator();
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = drafts.filter(d => projectKind(d) === kind && d.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  // 卡片上方的一行等宽细节：故事的角色和台词数、语音字数、歌曲风格、编曲速度与时长。
  const projectMeta = (draft: Draft) => kind === 'story' ? [t('@yovoice.subtitle.cues', { count: draft.subtitles?.cues.length ?? 0 }), ...(draft.subtitles?.speakers ?? []).slice(0, 3).map(s => s.sourceName)].join(' · ')
    : kind === 'music' ? [draft.instrumental ? t('@yovoice.music.instrumental') : '', draft.text.split(/[,，]/)[0]?.trim()].filter(Boolean).join(' · ') || t('@yovoice.project.music')
    : kind === 'score' ? draft.score?.tracks.length ? `${draft.score.tempo} BPM · ${formatTime(scoreDuration(draft.score))}` : t('@yovoice.project.score')
    : kind === 'sfx' ? formatTime(Number(draft.modelOptions?.stable_audio?.duration_seconds ?? 5))
    : t('@yovoice.app.charCount', { count: [...draft.text].length });
  // 摘录：歌曲取第一句歌词，编曲列出声部，其余取正文。
  const excerpt = (draft: Draft) => kind === 'music' ? (draft.lyrics ?? '').split('\n').map(line => line.trim()).find(line => line && !/^\[.*\]$/.test(line)) ?? ''
    : kind === 'score' ? (draft.score?.tracks ?? []).map(track => track.name).join(' · ') : draft.text.trim();
  // 按最近修改的月份分组；没有日期的旧作品不显示分组。
  const monthOf = (draft?: Draft) => { const stamp = draft?.updatedAt ?? draft?.createdAt; return stamp ? new Date(stamp).toLocaleDateString(document.documentElement.lang || undefined, { year: 'numeric', month: 'long' }) : ''; };
  async function update(next: Draft) {
    setBusy(true); setError('');
    try { await save(next); setRenaming(null); }
    catch (error) { setError(noticeMessage(error)); }
    finally { setBusy(false); }
  }
  return <>
    <LibraryPage title={title ?? t(`@yovoice.project.${kind}`)} controls={controls} layout="tickets" actions={create}
      query={query} onQueryChange={setQuery} searchLabel={t('@yovoice.project.search')} hasItems={drafts.some(d => projectKind(d) === kind)} hasResults={filtered.length > 0}
      noResults={t('@yovoice.library.noSearchResults')}
      empty={<LibraryEmpty art={kind === 'text' ? <TapeCover seed={`empty-${kind}`} title={t(`@yovoice.project.${kind}`)} /> : kind === 'sfx' ? <WaveRing seed={`empty-${kind}`} duration={5}><AudioWaveform /></WaveRing> : <RecordCover seed={`empty-${kind}`} title={t(`@yovoice.project.${kind}`)} />} title={t('@yovoice.project.empty')} action={create} />}>
      {filtered.map((draft, index) => {
        const stamp = draft.updatedAt ?? draft.createdAt, date = new Date(stamp ?? 0);
        const month = monthOf(draft), newMonth = !!month && month !== monthOf(filtered[index - 1]);
        const lead = draft.subtitles?.speakers ?? [];
        const avatarSeed = (id: string, characterId?: string) => characterId ?? `${draft.id}:${id}`;
        // 歌曲和编曲是唱片封套；音效是声波环；故事是封套上站着出场角色的有声唱片；语音是一盒写着标题的磁带。
        const cover = kind === 'music' || kind === 'score' ? <RecordCover seed={draft.id} title={draft.title} />
          : kind === 'sfx' ? <WaveRing seed={draft.id} duration={Number(draft.modelOptions?.stable_audio?.duration_seconds ?? 5)}><AudioWaveform /></WaveRing>
          : kind === 'story' ? <RecordCover seed={draft.id} title={draft.title} cast={lead.slice(0, 3).map(s => <SpeakerAvatar key={s.id} seed={avatarSeed(s.id, s.characterId)} />)} />
          : <TapeCover seed={draft.id} title={draft.title} />;
        return <VStack key={draft.id} gap={2}>
          {newMonth ? <small className="ticket-month eyebrow">{month}</small> : null}
          <Ticket className={`project-library-row ticket-${kind}`} coverClassName="project-avatars" index={index} cover={cover}
            eyebrow={projectMeta(draft)} excerpt={excerpt(draft)}
            title={<Button variant="ghost" className="project-title" label={draft.title} onPointerEnter={overflowTitle} onClick={() => open(draft)} />}
            stub={stamp ? <time className="project-created" dateTime={stamp} title={t('@yovoice.project.created', { date: new Date(draft.createdAt ?? date).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) })}>
              <b className="ticket-day">{date.getDate()}</b>
              <small className="eyebrow">{date.getFullYear()}.{String(date.getMonth() + 1).padStart(2, '0')}</small>
            </time> : null}
            stubActions={<DropdownMenu presentation="popover" alignment="end" menuWidth="calc(var(--spacing-10) * 4)" hasChevron={false}
              button={{ label: t('@yovoice.project.more'), icon: <MoreHorizontal />, isIconOnly: true, variant: 'ghost', size: 'sm' }}
              items={[
                ...(isDesktop ? [{ label: t('@yovoice.timeline.package'), onClick: () => void save(draft).then(() => call('project.export', { id: draft.id, name: draft.title })).catch(e => onError(noticeMessage(e))) }] : []),
                { id: 'rename', label: t('@yovoice.project.renameShort'), icon: <Pencil className="project-menu-icon" strokeWidth={1.5} />, onClick: () => { setError(''); setRenaming(draft); } },
                { id: 'copy', label: t('@yovoice.project.copyShort'), icon: <Copy className="project-menu-icon" strokeWidth={1.5} />, onClick: () => copy(draft) },
                ...(kind !== 'story' ? [{ id: 'history', label: t('@yovoice.history.versions'), icon: <History className="project-menu-icon" strokeWidth={1.5} />, onClick: () => history(draft) }] : []),
                { id: 'delete', label: t('@yovoice.action.delete'), icon: <Trash2 className="project-menu-icon" strokeWidth={1.5} />, variant: 'destructive', onClick: () => remove(draft) },
              ]} />} />
        </VStack>;
      })}
    </LibraryPage>
    {renaming ? <AppDialog title={t('@yovoice.project.rename')} busy={busy} error={formatNotice(t, error)} onClose={() => setRenaming(null)} actions={<>
      <Button label={t('@yovoice.action.cancel')} isDisabled={busy} onClick={() => setRenaming(null)} />
      <Button label={t('@yovoice.action.save')} variant="primary" isLoading={busy} isDisabled={!renaming.title.trim() || renaming.title.length > 120} onClick={() => void update({ ...renaming, title: renaming.title.trim() })} />
    </>}><TextInput label={t('@yovoice.app.titleLabel')} value={renaming.title} onChange={title => setRenaming({ ...renaming, title })} /></AppDialog> : null}
  </>;
}
