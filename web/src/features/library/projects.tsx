import { useState, type ReactNode, type ComponentProps } from 'react';
import { formatNotice } from '../../shared/i18n/format';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Copy, Folder, History, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { createDraft, projectKind, type Draft, type UiLocale } from '../../shared/workbench';
import { call, isDesktop } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { SpeakerAvatar } from '../create/subtitles';
import { createMusicDraft } from '../music/music-draft';
import { SongCover } from '../music/song-cover';
import { LibraryEmpty, LibraryPage } from './library-layout';

export function NewProject({ locale, modelId, create, onError, button, kind }: {
  kind?: 'text' | 'story' | 'music'; locale: UiLocale; modelId?: string; create: (draft: Draft) => Promise<void>; onError: (error: string) => void;
  button?: Omit<ComponentProps<typeof Button>, 'onClick' | 'label'> & { label?: string };
}) {
  const t = useTranslator();
  const [busy, setBusy] = useState(false);
  async function start(kind: 'text' | 'story' | 'music') {
    setBusy(true);
    const next: Draft = kind === 'music' ? createMusicDraft(locale, false) : { ...createDraft(false, locale, modelId), kind };
    if (kind === 'story') next.subtitles = { speakers: [{ id: crypto.randomUUID(), sourceName: t('@yovoice.library.narrator') }], cues: [] };
    try { await create(next); }
    catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  }
  if (kind) return <Button label={t(`@yovoice.project.new.${kind}`)} icon={<Plus />} size="sm" {...button} isLoading={busy} onClick={() => void start(kind)} />;
  return <DropdownMenu data-testid={button?.['data-testid']} presentation="popover" hasChevron={false}
    button={{ label: t('@yovoice.project.new'), icon: <Plus />, size: 'sm', ...button, isLoading: busy }}
    items={[
      { id: 'story', label: t('@yovoice.project.story'), onClick: () => void start('story') },
      { id: 'text', label: t('@yovoice.project.text'), onClick: () => void start('text') },
      { id: 'music', label: t('@yovoice.project.music'), onClick: () => void start('music') },
      ...(isDesktop ? [{ id: 'import', label: t('@yovoice.timeline.importProject'), onClick: () => { setBusy(true); void call<Draft | null>('project.import').then(d => d ? create(d) : undefined).catch(e => onError(noticeMessage(e))).finally(() => setBusy(false)); } }] : []),
    ]} />;
}

export function Projects({ drafts, kind, open, create, copy, save, remove, history, onError }: { onError: (error: string) => void;
  drafts: Draft[]; kind: 'text' | 'story' | 'music'; open: (draft: Draft) => void; create: ReactNode;
  history: (draft: Draft) => void; copy: (draft: Draft) => void; save: (draft: Draft) => Promise<void>; remove: (draft: Draft) => void;
}) {
  const t = useTranslator();
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = drafts.filter(d => projectKind(d) === kind && d.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  async function update(next: Draft) {
    setBusy(true); setError('');
    try { await save(next); setRenaming(null); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <LibraryPage title={t(`@yovoice.project.${kind}`)} layout="grid" actions={create}
      query={query} onQueryChange={setQuery} searchLabel={t('@yovoice.project.search')} hasItems={drafts.some(d => projectKind(d) === kind)} hasResults={filtered.length > 0}
      noResults={t('@yovoice.library.noSearchResults')}
      empty={<LibraryEmpty icon={<Folder />} title={t('@yovoice.project.empty')} action={create} />}>
      {filtered.map(draft => <VStack key={draft.id} className="library-entry project-library-row" gap={3}>
        <HStack gap={3} vAlign="center">
          <HStack className="project-avatars" gap={0} wrap="wrap" aria-hidden="true">
            {kind === 'music' ? <SongCover seed={draft.id} size={96} /> : draft.subtitles?.speakers.length ? draft.subtitles.speakers.map(speaker => <SpeakerAvatar key={speaker.id} seed={speaker.characterId ?? `${draft.id}:${speaker.id}`} />) : <SpeakerAvatar seed={draft.characterId ?? draft.id} />}
          </HStack>
          <Button variant="ghost" className="grow project-title" label={draft.title} tooltip={draft.title} onClick={() => open(draft)} />
          <HStack className="library-entry-actions" gap={0}>
            <DropdownMenu presentation="popover" alignment="end" menuWidth="calc(var(--spacing-10) * 4)" hasChevron={false}
              button={{ label: t('@yovoice.project.more'), icon: <MoreVertical />, isIconOnly: true, variant: 'ghost', size: 'sm' }}
              items={[
              ...(isDesktop ? [{ label: t('@yovoice.timeline.package'), onClick: () => void save(draft).then(() => call('project.export', { id: draft.id, name: draft.title })).catch(e => onError(noticeMessage(e))) }] : []),
                { id: 'rename', label: t('@yovoice.project.renameShort'), icon: <Pencil className="project-menu-icon" strokeWidth={1.5} />, onClick: () => { setError(''); setRenaming(draft); } },
                { id: 'copy', label: t('@yovoice.project.copyShort'), icon: <Copy className="project-menu-icon" strokeWidth={1.5} />, onClick: () => copy(draft) },
                ...(kind !== 'story' ? [{ id: 'history', label: t('@yovoice.history.versions'), icon: <History className="project-menu-icon" strokeWidth={1.5} />, onClick: () => history(draft) }] : []),
                { id: 'delete', label: t('@yovoice.action.delete'), icon: <Trash2 className="project-menu-icon" strokeWidth={1.5} />, variant: 'destructive', onClick: () => remove(draft) },
              ]} />
          </HStack>
        </HStack>
        {draft.createdAt ? <time className="project-created" dateTime={draft.createdAt}>{t('@yovoice.project.created', { date: new Date(draft.createdAt).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) })}</time> : null}
        {draft.text.trim() ? <p className="project-excerpt">{draft.text}</p> : null}

      </VStack>)}
    </LibraryPage>
    {renaming ? <AppDialog title={t('@yovoice.project.rename')} busy={busy} error={formatNotice(t, error)} onClose={() => setRenaming(null)} actions={<>
      <Button label={t('@yovoice.action.cancel')} isDisabled={busy} onClick={() => setRenaming(null)} />
      <Button label={t('@yovoice.action.save')} variant="primary" isLoading={busy} isDisabled={!renaming.title.trim() || renaming.title.length > 120} onClick={() => void update({ ...renaming, title: renaming.title.trim() })} />
    </>}><TextInput label={t('@yovoice.app.titleLabel')} value={renaming.title} onChange={title => setRenaming({ ...renaming, title })} /></AppDialog> : null}
  </>;
}
