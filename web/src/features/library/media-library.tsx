import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack } from '@astryxdesign/core/Layout';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { Clock3, Disc3, ListChecks, Mic, Plus, Trash2, MoreHorizontal } from 'lucide-react';
import { formatTime, projectKind, type Draft, type Generation, type State, type Track, type Voice } from '../../shared/workbench';
import { MediaActions } from '../media/media-actions';
import { call, CallError } from '../../shared/lib/client';
import { ConfirmDelete } from '../../shared/ui/app-dialog';
import { formatCallError, formatDateTime } from '../../shared/i18n/format';
import { Player } from '../media/player';
import { LibraryEmpty, LibraryPage, Ticket, TicketStamp, toggleTicketAudition } from './library-layout';
import { RecordCover } from './record-cover';
import { TapeCover } from './tape-cover';
import { WaveRing } from './wave-ring';
import { overflowTitle } from '../../shared/ui/overflow-title';
import { useHotkey, useHotkeyAria, useHotkeyText, withHotkey } from '../../shared/hotkeys/hotkeys';

// 版本记录一次先渲染的条数，更早的点“显示更早的”再展开，记录很多时打开页面和状态推送都不用重建整张列表。
const historyBatch = 30;

export function MediaLibrary({ page, state, query, onQueryChange, track, audition, stop, suspended, addVoice, editVoice, exportCaptions, saveCharacter, reuse, exportItem, share, play, separate, transcribe, openStems, resing, onError, controls, project }: {
  controls?: ReactNode; project: Draft;
  page: 'voices' | 'history'; state: State; query: string; onQueryChange: (value: string) => void;
  track: Track | null; audition: (track: Track) => void; stop: () => void; suspended: boolean;
  addVoice: () => void; editVoice: (item: Voice | Generation) => void; saveCharacter: (item: Generation) => void; reuse: (item: Generation) => void;
  exportItem: (item: Generation) => void; share: (item: Generation) => void; play: (item: Generation) => void; exportCaptions: (item: Generation) => void;
  separate: (item: Generation, replace?: boolean) => void; transcribe: (item: Generation) => void; openStems: (item: Generation) => void; resing: (item: Generation) => (() => void) | undefined;
  onError: (message: string) => void;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const voices = page === 'voices';
  // 语音生成是临时生成：历史生成列出所有语音作品的结果，不分版本；音乐与编曲的版本记录只属于当前作品，按版本编号。
  const kind = projectKind(project), quick = kind === 'text';
  // 作品按 id 建索引，版本号按位置预先算好，避免每条记录都遍历一遍作品与记录列表。
  const drafts = useMemo(() => new Map(state.drafts.map(d => [d.id, d])), [state.drafts]);
  const history = useMemo(() => kind === 'story' ? [] : state.history.filter(item => !item.segment && (quick ? projectKind(drafts.get(item.settings.id) ?? item.settings) === 'text' : item.settings.id === project.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.history, drafts, kind, quick, project.id]);
  // 分轨不占版本号，沿用原版本的号；已分过轨的版本不再显示“分离音轨”。
  const versions = useMemo(() => { const own = history.filter(item => !item.stemOf); const numbers = new Map(own.map((item, index) => [item.id, own.length - index])); for (const item of history) if (item.stemOf) numbers.set(item.id, numbers.get(item.stemOf) ?? 0); return numbers; }, [history]);
  const separated = useMemo(() => new Set(history.map(item => item.stemOf).filter(Boolean)), [history]);
  // 改过名的音频以名称为标题，否则显示正文（音乐是风格）。
  const heading = (item: Generation) => item.title !== item.settings.title ? item.title : item.settings.text.trim() || item.title;
  const count = voices ? state.voices.length : history.length;
  const search = query.trim().toLocaleLowerCase();
  const filteredVoices = state.voices.filter(voice => voice.name.toLocaleLowerCase().includes(search));
  const narrator = t('@yovoice.library.narrator');
  const filteredHistory = useMemo(() => {
    if (!search) return history;
    const characters = new Map(state.characters.map(c => [c.id, c.name]));
    const speakerName = (item: Generation) => item.segment?.speakerName || characters.get(item.settings.characterId ?? '') || narrator;
    return history.filter(item => [item.title, item.settings.text, speakerName(item), drafts.get(item.settings.id)?.title ?? ''].some(value => value.toLocaleLowerCase().includes(search)));
  }, [history, search, state.characters, drafts, narrator]);
  // 展开的条数随搜索词与列表切换重置。
  const listKey = `${page}/${project.id}/${search}`;
  const [shown, setShown] = useState({ key: listKey, count: historyBatch });
  const shownCount = shown.key === listKey ? shown.count : historyBatch;
  // 正在试听的语音历史，用来让磁带卷轴转动。
  const [playingId, setPlayingId] = useState<string | null>(null);
  // 批量删除参考音频：null 表示未进入选择模式。
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [batchError, setBatchError] = useState('');
  const visiblePicked = filteredVoices.filter(voice => picked?.has(voice.id));
  const toggle = (id: string, checked: boolean) => setPicked(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
  async function deletePicked() {
    if (deleting) return;
    setDeleting(true); setBatchError(''); stop();
    // 逐条删除；仍被角色或作品使用的参考音频跳过并保留勾选，其余照常删除。
    const referenced: string[] = []; let failure = '';
    for (const voice of visiblePicked) {
      try { await call('media.delete', { kind: 'voices', id: voice.id }); toggle(voice.id, false); }
      catch (e) { if (e instanceof CallError && e.code === '@yovoice.error.voiceReferenced') referenced.push(voice.name); else failure ||= formatCallError(t, e); }
    }
    setDeleting(false);
    const messages = [referenced.length ? t('@yovoice.library.batchDeleteReferenced', { names: referenced.join('、') }) : '', failure].filter(Boolean);
    if (messages.length) setBatchError(messages.join(' '));
    else { setConfirming(false); setPicked(null); }
  }
  const allPicked = filteredVoices.length > 0 && visiblePicked.length === filteredVoices.length;
  // 参考音频页的快捷键：页面常驻挂载，只在这一页显示、且没有被选择器、编辑框等盖住（suspended）时生效。
  // 空格试听点过或焦点所在的卡片，其次是正在试听的，都没有时是第一张；批量删除时空格留给勾选框（鼠标点过的勾选框也是），不试听。
  const pageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const previewTarget = [selectedVoice, track?.id].find(id => id && filteredVoices.some(voice => voice.id === id)) ?? filteredVoices[0]?.id;
  const voicesActive = voices && !suspended;
  useHotkey('global.new', addVoice, { enabled: voicesActive && !picked });
  useHotkey('refs.search', () => { searchRef.current?.focus(); searchRef.current?.select(); }, { enabled: voicesActive && count > 0 });
  useHotkey('refs.preview', () => { if (previewTarget) toggleTicketAudition(pageRef.current, previewTarget); }, { enabled: voicesActive && !!previewTarget && !picked });
  const addKeys = useHotkeyText('global.new'), addAria = useHotkeyAria('global.new');
  const searchKeys = useHotkeyText('refs.search'), searchAria = useHotkeyAria('refs.search');
  const addButton = (label: string) => <Button label={label} tooltip={withHotkey(label, addKeys, undefined)} aria-keyshortcuts={addAria} size="sm" icon={<Plus />} onClick={addVoice} />;
  const voiceActions = picked ? <HStack gap={2} vAlign="center" wrap="wrap">
    <CheckboxInput label={t('@yovoice.library.selectAll')} size="sm" value={allPicked ? true : visiblePicked.length ? 'indeterminate' : false} onChange={checked => setPicked(new Set(checked ? filteredVoices.map(voice => voice.id) : []))} />
    <Button label={t('@yovoice.library.deletePicked', { n: visiblePicked.length })} size="sm" variant="destructive" icon={<Trash2 />} isDisabled={!visiblePicked.length} onClick={() => { setBatchError(''); setConfirming(true); }} />
    <Button label={t('@yovoice.library.finishPicking')} size="sm" onClick={() => setPicked(null)} />
  </HStack> : <HStack gap={2} vAlign="center" wrap="wrap">
    {count > 1 ? <Button label={t('@yovoice.library.batchDelete')} size="sm" variant="secondary" icon={<ListChecks />} onClick={() => setPicked(new Set())} /> : null}
    {addButton(t('@yovoice.library.addVoice'))}
  </HStack>;
  return <LibraryPage controls={voices ? controls : undefined} title={voices ? t('@yovoice.library.voicesTitle') : quick ? t('@yovoice.history.generations') : `${project.title} · ${t('@yovoice.history.versions')}`}
    actions={voices && count > 0 ? voiceActions : voices ? undefined : controls}
    pageRef={voices ? pageRef : undefined} searchRef={voices ? searchRef : undefined} searchKeys={voices ? searchKeys : undefined} searchAria={voices ? searchAria : undefined}
    query={query} onQueryChange={onQueryChange} searchLabel={t(voices ? '@yovoice.library.searchVoices' : quick ? '@yovoice.library.searchGenerations' : '@yovoice.library.searchHistory')}
    hasItems={count > 0} hasResults={(voices ? filteredVoices : filteredHistory).length > 0} layout="tickets"
    noResults={t('@yovoice.library.noSearchResults')}
    empty={<LibraryEmpty icon={<Clock3 />} art={voices ? <WaveRing seed="empty-voice" duration={12}><HStack className="empty-ring-mark" gap={0} hAlign="center" vAlign="center"><Mic /></HStack></WaveRing> : undefined} title={t(voices ? '@yovoice.library.emptyVoicesTitle' : quick ? '@yovoice.library.emptyGenerationsTitle' : '@yovoice.library.emptyHistoryTitle')}
      action={voices ? addButton(t('@yovoice.library.addFirstVoice')) : null} />}>
    {/* 参考音频：头像外围一圈声波，点卡片试听；顶部标出来源（导入或来自生成），存根显示时长。 */}
    {voices ? filteredVoices.map((voice, index) => <Ticket key={voice.id} index={index} className="voice-row" itemId={voice.id} selected={voice.id === selectedVoice} onSelect={() => setSelectedVoice(voice.id)}
      cover={<WaveRing seed={voice.id} duration={voice.duration}><Player compact avatar={{ seed: voice.id, label: t('@yovoice.app.audition', { name: voice.name }), select: () => audition({ ...voice, kind: 'voices', subtitle: t('@yovoice.app.subtitleReference') }) }} suspended={suspended} track={track?.id === voice.id ? track : null} onError={onError} /></WaveRing>}
      eyebrow={voice.source === 'generation' ? t('@yovoice.voice.sourceGeneration') : voice.source === 'import' ? t('@yovoice.voice.sourceImport') : undefined}
      title={<h3 onPointerEnter={overflowTitle}>{voice.name}</h3>} excerpt={voice.referenceText?.trim()}
      stub={<TicketStamp value={formatTime(voice.duration)} unit={t('@yovoice.library.duration')} />}
      actions={picked ? <CheckboxInput label={t('@yovoice.library.pickVoice', { name: voice.name })} isLabelHidden value={picked.has(voice.id)} onChange={checked => toggle(voice.id, checked)} />
        : <MediaActions onEdit={() => editVoice(voice)} item={{ ...voice, kind: 'voices' }} beforeDelete={stop} onError={onError} />} />)
      // 历史也用票根：音乐与编曲是唱片（点唱片中心试听，播放时转动），语音是写着正文的磁带（试听时卷轴转动）。
      : filteredHistory.slice(0, shownCount).map((item, index) => {
        const name = heading(item), selected = track?.id === item.id;
        const version = t('@yovoice.app.historyVersion', { n: versions.get(item.id) ?? 0 }) + (item.stem ? ` · ${t(`@yovoice.stems.name.${item.stem}`)}` : '') + (item.patchBars?.length === 2 ? ` · ${t('@yovoice.resing.label', { from: item.patchBars[0], to: item.patchBars[1] })}` : '');
        const date = formatDateTime(item.createdAt, locale, 'log');
        const listen = () => audition({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') });
        const firstLyric = item.settings.lyrics?.split('\n').map(line => line.trim()).find(line => line && !/^\[[^\]]*\]$/.test(line));
        const excerpt = kind === 'music' ? (item.settings.instrumental ? t('@yovoice.music.instrumental') : firstLyric) : name !== item.settings.text.trim() ? item.settings.text.trim() : undefined;
        return <Ticket key={item.id} index={index} className={`history-item ticket-${kind}`} coverClassName={selected && playingId === item.id ? 'is-playing' : ''}
          cover={quick ? <TapeCover seed={item.id} title={name} />
            : kind === 'sfx' ? <WaveRing seed={item.id} duration={item.duration}><Player compact avatar={{ seed: item.id, label: t('@yovoice.app.audition', { name }), select: listen }} suspended={suspended} track={selected ? track : null} onError={onError} /></WaveRing>
            : <RecordCover seed={item.id} interactive><Player compact avatar={{ seed: item.id, label: t('@yovoice.app.audition', { name }), select: listen }} suspended={suspended} track={selected ? track : null} onError={onError} /></RecordCover>}
          eyebrow={<HStack className="history-meta" gap={2}>{quick ? null : <b>{version}</b>}<time dateTime={item.createdAt}>{date}</time></HStack>}
          title={<h3 onPointerEnter={overflowTitle} data-full-text={item.settings.text}>{name}</h3>} excerpt={excerpt}
          stub={<TicketStamp value={formatTime(item.duration)} unit={t('@yovoice.library.duration')} />}
          actions={<>
            {quick ? <Player inline={{ label: t('@yovoice.app.audition', { name }), select: listen }} suspended={suspended} track={selected ? track : null} onError={onError} onProgress={(_, playing) => setPlayingId(current => playing ? item.id : current === item.id ? null : current)} /> : null}
            {kind === 'music' ? <Button label={t('@yovoice.music.openNowPlaying', { name })} tooltip={t('@yovoice.music.nowPlaying')} size="sm" variant="ghost" isIconOnly icon={<Disc3 />} onClick={() => { stop(); play(item); }} /> : null}
            <DropdownMenu className="audio-actions-menu" presentation="popover" alignment="end" hasChevron={false} button={{ label: t('@yovoice.history.audioActions'), size: 'sm', variant: 'ghost', isIconOnly: true, icon: <MoreHorizontal /> }} items={[
              { label: t('@yovoice.app.exportVersion'), onClick: () => exportItem(item) },
              ...(kind === 'music' && !item.stemOf ? [{ label: t('@yovoice.community.share'), onClick: () => share(item) }] : []),
              ...(quick ? [{ label: t('@yovoice.caption.menu'), onClick: () => exportCaptions(item) }, { label: t('@yovoice.voice.save'), onClick: () => editVoice(item) }, { label: t('@yovoice.character.saveAs'), onClick: () => saveCharacter(item) }] : []),
              ...(kind === 'music' && resing(item) ? [{ label: t('@yovoice.resing.action'), onClick: resing(item)! }] : []),
              ...(kind === 'music' && !item.stemOf && !separated.has(item.id) ? [{ label: t('@yovoice.stems.separate'), onClick: () => separate(item) }] : []),
              ...(kind === 'music' && (item.stemOf || separated.has(item.id)) ? [{ label: t('@yovoice.stems.open'), onClick: () => openStems(item) }] : []),
              ...(kind === 'music' && !item.stemOf && separated.has(item.id) ? [{ label: t('@yovoice.stems.resplit'), onClick: () => separate(item, true) }] : []),
              ...(kind === 'music' ? [{ label: t('@yovoice.stems.toMidi'), onClick: () => transcribe(item) }] : []),
              { label: t(kind === 'music' ? '@yovoice.music.reuseTake' : '@yovoice.app.reuseSettings'), onClick: () => reuse(item) },
            ]} />
            <MediaActions item={{ id: item.id, kind: 'outputs', name: item.title }} beforeDelete={stop} onError={onError} />
          </>} />;
      })}
    {!voices && filteredHistory.length > shownCount ? <Button className="history-more" label={t('@yovoice.library.showEarlier', { n: Math.min(historyBatch, filteredHistory.length - shownCount) })} variant="secondary" size="sm"
      onClick={() => setShown({ key: listKey, count: shownCount + historyBatch })} /> : null}

    {confirming ? <ConfirmDelete title={t('@yovoice.library.deletePickedTitle', { n: visiblePicked.length })}
      description={t('@yovoice.library.deletePickedBody') + t('@yovoice.media.deleteVoiceExtra')}
      confirmLabel={t('@yovoice.library.deletePicked', { n: visiblePicked.length })} busy={deleting} error={batchError} onClose={() => setConfirming(false)} onConfirm={() => void deletePicked()} /> : null}
  </LibraryPage>;
}
