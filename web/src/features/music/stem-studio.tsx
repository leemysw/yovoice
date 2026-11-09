import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Slider } from '@astryxdesign/core/Slider';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Download, Headphones, LoaderCircle, Pause, Play, RotateCcw, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { call, CallError } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import { ConfirmDelete } from '../../shared/ui/app-dialog';
import { formatTime, type Draft, type Generation, type StemName } from '../../shared/workbench';
import { waveform as readWaveform, type Waveform } from '../media/waveform';
import { useMultitrack, type TrackMix } from '../media/use-multitrack';

// 分轨工作台要打开的内容：一个版本分离出的音轨，或一个编曲作品（转 MIDI 的结果）逐轨渲染后的试听。
export type StudioTarget = { kind: 'stems'; sourceId: string } | { kind: 'midi'; projectId: string; sourceId?: string };

type StudioTrack = { id: string; name: string; fileName: string; reference?: boolean; color: string };

// 分轨按常见混音台的顺序排列：人声在最上，节奏组随后。
const stemOrder: StemName[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
const colors = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'yellow'];
// 波形取样数：够画满一条宽轨道，又不必为长歌读太多数据。
const bins = 720;

/**
 * 分轨工作台：像调音台一样把原曲和每一轨并排列出，统一播放、定位，每轨可静音、独奏、调音量，
 * 用来听清分离或转换的效果。分轨来自 HTDemucs 的分离结果；转 MIDI 的结果用编曲音色库逐轨渲染后试听。
 * 原曲作为参照轨默认静音，独奏原曲即可与分轨对比。空格播放暂停。
 */
export function StemStudio({ target, history, project, onClose, onExport, onResplit, onDeleteStems, busy, openSoundFonts }: {
  target: StudioTarget; history: Generation[]; project?: Draft; onClose: () => void;
  onExport?: (source: Generation) => void; onResplit?: (source: Generation) => void; onDeleteStems?: (source: Generation) => Promise<void>;
  busy?: boolean; openSoundFonts: () => void;
}) {
  const t = useTranslator();
  const source = history.find(item => item.id === target.sourceId);
  const [rendered, setRendered] = useState<{ id: string; name: string; fileName: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const score = target.kind === 'midi' ? project?.score : undefined;
  const scoreKey = score ? JSON.stringify(score) : '';
  useEffect(() => {
    if (target.kind !== 'midi' || !scoreKey) return;
    let cancelled = false;
    setRendered(null); setError(null);
    call<{ id: string; name: string; fileName: string }[]>('score.renderTracks', { score: JSON.parse(scoreKey) })
      .then(tracks => { if (!cancelled) setRendered(tracks); }, e => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, [target.kind, scoreKey]);

  const tracks = useMemo<StudioTrack[]>(() => {
    const list: StudioTrack[] = source ? [{ id: source.id, name: t('@yovoice.stems.original'), fileName: source.fileName, reference: true, color: 'gray' }] : [];
    if (target.kind === 'stems') {
      const stems = history.filter(item => item.stemOf === target.sourceId && item.stem).sort((a, b) => stemOrder.indexOf(a.stem!) - stemOrder.indexOf(b.stem!));
      stems.forEach((item, i) => list.push({ id: item.id, name: t(`@yovoice.stems.name.${item.stem}`), fileName: item.fileName, color: colors[i % colors.length] }));
    } else {
      (rendered ?? []).forEach((item, i) => list.push({ id: item.id, name: item.name, fileName: item.fileName, color: colors[i % colors.length] }));
    }
    return list;
  }, [source, target, history, rendered, t]);

  // 原曲是参照：默认静音，独奏它就能和分轨对比。
  const [mix, setMix] = useState<Record<string, TrackMix>>({});
  const mixFor = (track: StudioTrack): TrackMix => mix[track.id] ?? { mute: !!track.reference, solo: false, volume: 1 };
  const fullMix = useMemo(() => Object.fromEntries(tracks.map(track => [track.id, mix[track.id] ?? { mute: !!track.reference, solo: false, volume: 1 }])), [tracks, mix]);
  const update = (track: StudioTrack, patch: Partial<TrackMix>) => setMix(current => ({ ...current, [track.id]: { ...mixFor(track), ...current[track.id], ...patch } }));

  // 播放头与时间直接写进 DOM，播放时不让整个工作台每帧重渲染。
  const board = useRef<HTMLElement>(null);
  const clock = useRef<HTMLElement>(null);
  const total = useRef(0);
  const player = useMultitrack(tracks, fullMix, time => {
    const length = total.current || 1;
    board.current?.style.setProperty('--stem-progress', String(Math.min(1, time / length)));
    if (clock.current) clock.current.textContent = formatTime(time);
  }, e => setError(e));
  const { playing, toggle, seek, ready, duration } = player;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // 删除分轨前先停播；成功后由外层关闭工作台，失败（例如分轨还在时间线上）时把原因留在确认框里。
  const removeStems = async (item: Generation, remove: (source: Generation) => Promise<void>) => {
    if (playing) toggle();
    setDeleting(true); setDeleteError('');
    try { await remove(item); } catch (e) { setDeleteError(formatCallError(t, e)); setDeleting(false); }
  };
  total.current = duration;

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || (event.target as HTMLElement)?.closest('input, textarea, button, [role="slider"]')) return;
      event.preventDefault(); toggle();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [toggle]);

  // 各轨波形按顺序读取（每条恒定内存），读到一条画一条。
  const [waves, setWaves] = useState<Record<string, Waveform>>({});
  useEffect(() => {
    if (!ready) return;
    const abort = new AbortController();
    void (async () => {
      for (const track of tracks) {
        const url = player.urls[track.id];
        if (!url || abort.signal.aborted) continue;
        try { const wave = await readWaveform(url, bins, abort.signal); setWaves(current => ({ ...current, [track.id]: wave })); } catch { /* 读不到波形时该轨只显示空白条，仍可播放 */ }
      }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, player.urls]);

  const soundFontMissing = error instanceof CallError && error.code === '@yovoice.error.melodySoundFontRequired';
  const rendering = target.kind === 'midi' && !rendered && !error;
  const subtitle = target.kind === 'stems' ? t('@yovoice.stems.studioStems', { count: tracks.length - (source ? 1 : 0) }) : t('@yovoice.stems.studioMidi', { count: rendered?.length ?? 0 });
  const title = target.kind === 'midi' ? project?.title ?? '' : source?.title ?? '';
  const seekAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * duration);
  };

  return <Dialog className="stem-studio-dialog" isOpen variant="fullscreen" padding={0} aria-label={t('@yovoice.stems.studioTitle', { title })} onOpenChange={open => { if (!open) onClose(); }}>
    <VStack className="stem-studio" gap={0}>
      <HStack className="stem-studio-header" gap={3} vAlign="center">
        <VStack className="grow" gap={0}><h2>{t('@yovoice.stems.studioTitle', { title })}</h2><small>{subtitle}</small></VStack>
        {target.kind === 'stems' && source && onResplit ? <Button size="sm" variant="ghost" icon={<RotateCcw />} label={t('@yovoice.stems.resplit')} isDisabled={busy} onClick={() => onResplit(source)} /> : null}
        {target.kind === 'stems' && source && onDeleteStems ? <Button size="sm" variant="ghost" icon={<Trash2 />} label={t('@yovoice.stems.delete')} onClick={() => { setDeleteError(''); setConfirmDelete(true); }} /> : null}
        {target.kind === 'stems' && source && onExport ? <Button size="sm" variant="secondary" icon={<Download />} label={t('@yovoice.stems.exportAll')} onClick={() => onExport(source)} /> : null}
        <Button size="sm" variant="ghost" isIconOnly icon={<X />} label={t('@yovoice.action.close')} onClick={onClose} />
      </HStack>
      <HStack className="stem-transport" gap={3} vAlign="center">
        <Button variant="primary" isIconOnly icon={playing ? <Pause /> : <Play />} label={t(playing ? '@yovoice.player.pause' : '@yovoice.player.play')} isDisabled={!ready || tracks.length === 0} onClick={toggle} />
        <small className="stem-time"><StackItem as="span" ref={clock}>{formatTime(0)}</StackItem> / {formatTime(duration)}</small>
      </HStack>
      {soundFontMissing ? <VStack className="stem-studio-empty" gap={3} hAlign="center" role="status">
        <p>{t('@yovoice.stems.needSoundFont')}</p>
        <Button variant="primary" label={t('@yovoice.score.downloadSoundFont')} onClick={openSoundFonts} />
      </VStack> : error ? <p className="stem-studio-empty" role="alert">{formatCallError(t, error)}</p> : null}
      {rendering ? <HStack className="stem-studio-empty" gap={2} hAlign="center" vAlign="center" role="status"><LoaderCircle className="generation-spinner" size={16} aria-hidden /><small>{t('@yovoice.stems.rendering')}</small></HStack> : null}
      <VStack className="stem-board" gap={0}><VStack ref={board} className="stem-rack" gap={2} style={{ '--stem-progress': 0 } as CSSProperties} role="group" aria-label={subtitle}>
        {tracks.map(track => {
          const item = mixFor(track);
          const wave = waves[track.id];
          const audible = Object.values(fullMix).some(value => value.solo) ? item.solo : !item.mute;
          return <HStack key={track.id} className="stem-track" data-color={track.color} data-reference={track.reference || undefined} data-silent={!audible || undefined} gap={0}>
            <HStack className="stem-track-head" gap={2} vAlign="center">
              <StackItem as="span" className="stem-swatch" aria-hidden />
              <VStack className="grow" gap={1}>
                <b className="stem-track-name">{track.name}</b>
                <Slider label={t('@yovoice.stems.volume', { name: track.name })} isLabelHidden valueDisplay="none" min={0} max={1} step={0.01} value={item.volume} onChange={(volume: number) => update(track, { volume })} />
              </VStack>
              <Button size="sm" variant={item.mute ? 'primary' : 'ghost'} isIconOnly className="stem-toggle" icon={item.mute ? <VolumeX /> : <Volume2 />} label={t('@yovoice.stems.mute', { name: track.name })} tooltip={t('@yovoice.stems.mute', { name: track.name })} aria-pressed={item.mute} onClick={() => update(track, { mute: !item.mute })} />
              <Button size="sm" variant={item.solo ? 'primary' : 'ghost'} isIconOnly className="stem-toggle" icon={<Headphones />} label={t('@yovoice.stems.solo', { name: track.name })} tooltip={t('@yovoice.stems.solo', { name: track.name })} aria-pressed={item.solo} onClick={() => update(track, { solo: !item.solo })} />
            </HStack>
            <StackItem className="stem-lane" onPointerDown={seekAt} aria-hidden>
              {wave ? <svg viewBox={`0 0 ${wave.peaks.length} 100`} preserveAspectRatio="none" style={{ width: `${duration ? Math.min(100, wave.duration / duration * 100) : 100}%` }}>
                <path d={wave.peaks.map((peak, i) => `M${i + .5} ${50 - Math.max(.5, peak * 46)}V${50 + Math.max(.5, peak * 46)}`).join('')} />
              </svg> : null}
            </StackItem>
          </HStack>;
        })}
        {tracks.length ? <StackItem as="span" className="stem-playhead" aria-hidden /> : null}
      </VStack></VStack>
    </VStack>
    {confirmDelete && source && onDeleteStems ? <ConfirmDelete title={t('@yovoice.stems.deleteTitle')} description={t('@yovoice.stems.deleteDescription')}
      confirmLabel={t('@yovoice.stems.delete')} busy={deleting} error={deleteError} onClose={() => setConfirmDelete(false)} onConfirm={() => void removeStems(source, onDeleteStems)} /> : null}
  </Dialog>;
}
