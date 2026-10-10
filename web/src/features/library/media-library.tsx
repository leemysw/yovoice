import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { Clock3, Mic, Play, Plus, X, MoreHorizontal } from 'lucide-react';
import { formatTime, projectKind, type Draft, type Generation, type State, type Track, type Voice } from '../../shared/workbench';
import { MediaActions } from '../media/media-actions';
import { Player } from '../media/player';
import { LibraryEmpty, LibraryEntry, LibraryPage } from './library-layout';

export function MediaLibrary({ page, state, query, onQueryChange, track, audition, stop, suspended, addVoice, editVoice, reuse, onError, controls, project }: {
  controls?: ReactNode; project: Draft;
  page: 'voices' | 'history'; state: State; query: string; onQueryChange: (value: string) => void;
  track: Track | null; audition: (track: Track) => void; stop: () => void; suspended: boolean;
  addVoice: () => void; editVoice: (item: Voice | Generation) => void; reuse: (item: Generation) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const voices = page === 'voices';
  const history = projectKind(project) !== 'story' ? state.history.filter(item => item.settings.id === project.id && !item.segment).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const count = voices ? state.voices.length : history.length;
  const search = query.trim().toLocaleLowerCase();
  const filteredVoices = state.voices.filter(voice => voice.name.toLocaleLowerCase().includes(search));
  const speakerName = (item: Generation) => item.segment?.speakerName || state.characters.find(c => c.id === item.settings.characterId)?.name || t('@yovoice.library.narrator');
  const filteredHistory = history.filter(item => [item.title, item.settings.text, speakerName(item), state.drafts.find(d => d.id === item.settings.id)?.title ?? ''].some(value => value.toLocaleLowerCase().includes(search)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dateOptions: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  return <LibraryPage controls={voices ? controls : undefined} title={voices ? t('@yovoice.library.voicesTitle') : `${project.title} · ${t('@yovoice.history.versions')}`}
    actions={voices && count > 0 ? <Button label={t('@yovoice.library.addVoice')} size="sm" icon={<Plus />} onClick={addVoice} /> : voices ? undefined : controls}
    query={query} onQueryChange={onQueryChange} searchLabel={t(voices ? '@yovoice.library.searchVoices' : '@yovoice.library.searchHistory')}
    hasItems={count > 0} hasResults={(voices ? filteredVoices : filteredHistory).length > 0} layout={voices ? 'grid' : 'list'}
    noResults={t('@yovoice.library.noSearchResults')}
    empty={<LibraryEmpty icon={voices ? <Mic /> : <Clock3 />} title={t(voices ? '@yovoice.library.emptyVoicesTitle' : '@yovoice.library.emptyHistoryTitle')}
      action={voices ? <Button label={t('@yovoice.library.addFirstVoice')} variant="primary" onClick={addVoice} /> : null} />}>
    {voices ? filteredVoices.map(voice => <LibraryEntry key={voice.id} title={voice.name} description={voice.referenceText} metadata={<small className="time">{formatTime(voice.duration)}</small>}
      avatar={<Player compact avatar={{ seed: voice.id, label: t('@yovoice.app.audition', { name: voice.name }), select: () => audition({ ...voice, kind: 'voices', subtitle: t('@yovoice.app.subtitleReference') }) }} suspended={suspended} track={track?.id === voice.id ? track : null} onError={onError} />}
      actions={<MediaActions onEdit={() => editVoice(voice)} item={{ ...voice, kind: 'voices' }} beforeDelete={stop} onError={onError} />} />)
      : filteredHistory.map(item => <VStack key={item.id} className="history-item" gap={0}>
            <HStack className="history-row" gap={3} vAlign="center">
              <Button label={t(track?.id === item.id ? '@yovoice.app.collapseAudition' : '@yovoice.app.audition', { name: item.title })} size="sm" variant="ghost" isIconOnly icon={track?.id === item.id ? <X /> : <Play />} onClick={() => audition({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') })} />
              <VStack gap={1} className="history-info"><h3 title={item.settings.text}>{item.settings.text.trim() || item.title}</h3><HStack className="history-meta" gap={3}><small>{t('@yovoice.app.historyVersion', { n: history.length - history.indexOf(item) })}</small><small>{new Date(item.createdAt).toLocaleString(locale, dateOptions)}</small></HStack></VStack>
              <small className="time">{formatTime(item.duration)}</small>
              <HStack className="history-actions" gap={1}>
                <DropdownMenu className="audio-actions-menu" presentation="popover" alignment="end" hasChevron={false} button={{ label: t('@yovoice.history.audioActions'), size: 'sm', variant: 'ghost', isIconOnly: true, icon: <MoreHorizontal /> }} items={[
                  { label: t('@yovoice.voice.save'), onClick: () => editVoice(item) },
                  { label: t('@yovoice.app.reuseSettings'), onClick: () => reuse(item) },
                ]} />
                <MediaActions item={{ id: item.id, kind: 'outputs', name: item.title }} beforeDelete={stop} onError={onError} />
              </HStack>
            </HStack>
            {track?.id === item.id ? <Player compact suspended={suspended} track={track} onError={onError} /> : null}
          </VStack>)}

  </LibraryPage>;
}
