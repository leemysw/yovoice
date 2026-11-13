import { PlaybackToolbar, TrackZoom } from './playback-toolbar';
import { useEffect, useEffectEvent, useRef, useState, useReducer } from 'react';
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ResizeHandle } from '@astryxdesign/core/Resizable';
import { useAudioPanel } from './use-audio-panel';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Upload, History, FileAudio, Plus, Scissors, Trash2, RefreshCw, Undo2, Redo2, Magnet, MoreHorizontal, AudioLines } from 'lucide-react';
import { isDesktop, importTimelineFile, importTimelineGeneration } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { projectKind, type AudioAsset, type AudioClip, type AudioTimeline, type Generation, type Draft } from '../../shared/workbench';
import { Timeline, TimelineHistory, importError, type AudioSource } from './timeline';
import { useTimelineViewport } from './use-timeline-viewport';
import { useTimelinePlayback } from './use-timeline-playback';
import { useTimelineGestures } from './use-timeline-gestures';
import { useTimelineShortcuts } from './use-timeline-shortcuts';
import { useClipWaveforms } from './use-clip-waveforms';
import { TimelineExportDialog } from './timeline-export-dialog';
import { GenerationImportDialog, HistoryImportDialog } from './timeline-source-dialogs';
import { TrackHeader } from './track-header';
import { ClipRegion, GapHandle, type ClipSharedProps } from './clip-region';
import { platform, useHotkey, useHotkeyAria, useHotkeyText, withHotkey } from '../../shared/hotkeys/hotkeys';
import { bindingAria, bindingText } from '../../shared/hotkeys/keys';

// 固定按键的显示：主修饰键 macOS 是 ⌘、其他平台是 Ctrl；删除片段在 macOS 键盘上是退格（⌫），Windows / Linux 显示 Delete，两种键都能删除。
const fixedKeys = {
  copy: bindingText('mod+C', platform), paste: bindingText('mod+V', platform),
  remove: bindingText(platform === 'mac' ? 'backspace' : 'delete', platform), ripple: bindingText(platform === 'mac' ? 'shift+backspace' : 'shift+delete', platform),
  undo: bindingText('mod+Z', platform), redo: bindingText('mod+shift+Z', platform),
  // 拖动时按住它临时不吸附：macOS 是 ⌥，其他平台是 Alt。
  noSnap: platform === 'mac' ? '⌥' : 'Alt',
  undoAria: bindingAria('mod+Z', platform), redoAria: [bindingAria('mod+shift+Z', platform), ...(platform === 'mac' ? [] : [bindingAria('mod+Y', platform)])].join(' '),
};

export function TimelineEditor({ draft, drafts, busy, regenerate, exportProject, selectCue, selectedCue, cueSelectionRevision, playbackCue, value, history, change, suspended, onError }: {
  exportProject: () => Promise<void>; cueSelectionRevision?: number; selectedCue?: number; playbackCue?: (index: number) => void; draft: Draft; drafts: Draft[]; busy: boolean; regenerate: (cueId: string, clipId: string) => Promise<void>; selectCue: (index: number) => void;
  value: AudioTimeline; history: Generation[]; change: (value: AudioTimeline) => void; suspended: boolean; onError: (message: string) => void;
}) {
  const t = useTranslator();
  const panel = useAudioPanel(value.tracks.length > 0, 'audio-multitrack-height');
  const input = useRef<HTMLInputElement>(null);
  const uploadTrack = useRef('');
  const latest = useRef(value);
  latest.current = value;
  const [importing, setImporting] = useState(false);
  // 两个导入对话框以目标音轨 id 标记是否打开，框内的搜索词与错误由对话框自己持有。
  const [historyTrack, setHistoryTrack] = useState('');
  const [generationTrack, setGenerationTrack] = useState('');
  const [selected, setSelected] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [snap, setSnap] = useState(true);
  const [range, setRange] = useState<{ start: number; end: number }>();
  const [activeLane, setActiveLane] = useState(0);
  const clipboard = useRef<{ clip: AudioClip; lane: number }[]>([]);
  const cueFromClip = useRef<number | undefined>(undefined);
  const [edits] = useState(() => new TimelineHistory(value));
  const [, refreshEdits] = useReducer(count => count + 1, 0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const duration = Timeline.duration(value);
  const { scrollRef, rulerRef, zoom, scale, minZoom, zoomTo, fitAll, fitRange, tickStep, firstTick, tickCount } = useTimelineViewport(duration);

  const audioSources = new Map<string, AudioSource>([
    ...history.map(g => [g.id, g] as const),
    ...(value.assets ?? []).map(asset => [`asset:${asset.id}`, { ...asset, title: asset.name }] as const),
  ]);
  const { time, setTime, playing, loading, context, buffers, abort, load, stop, play, seek } = useTimelinePlayback({ value, duration, range, history, draft, audioSources, playbackCue, onError });
  const edit = (next: AudioTimeline) => {
    if (!edits.record(next, selected)) return;
    stop(); refreshEdits(); change(next);
  };
  const historyBlocked = suspended || importing || exporting || regenerating || busy || !!historyTrack || !!generationTrack || exportOpen;
  const gestures = useTimelineGestures({ scrollRef, blocked: historyBlocked, stop, seek, edit, setRange });
  const { gesture, trimPreview, setTrimPreview, guide, finishGesture, beginGesture, pointerHandlers } = gestures;
  // 暂停或时间线被外部替换时，中止播放与未完成的拖动。
  const halt = useEffectEvent(() => { stop(); finishGesture(false); });
  const recordEdit = useEffectEvent((next: AudioTimeline) => { if (edits.record(next, selected)) refreshEdits(); });
  // 时间线不可见时停止播放并让音频上下文休眠，不占用音频线程；再播放时 play 会先恢复它。
  useEffect(() => { if (suspended) { halt(); void context.current?.suspend().catch(() => undefined); } }, [suspended, context]);
  useEffect(() => { halt(); setTrimPreview(null); recordEdit(value); }, [value, setTrimPreview]);
  const selectedIds = selection;
  const editable = selectedIds.length > 0 && !value.tracks.some(t => t.locked && t.clips.some(c => selectedIds.includes(c.id)));
  const restoreEdit = (direction: 'undo' | 'redo') => {
    if (historyBlocked || gesture.current) return;
    const snapshot = edits.restore(direction, selected);
    if (!snapshot) return;
    stop(); setTrimPreview(null); setSelected(snapshot.selected); setSelection(snapshot.selected ? [snapshot.selected] : []);
    setTime(current => Math.min(current, Timeline.duration(snapshot.value)));
    const restored = snapshot.value.tracks.flatMap(track => track.clips).find(c => c.id === snapshot.selected);
    if (restored) selectClip(restored);
    refreshEdits(); change(snapshot.value);
  };
  const copy = () => { clipboard.current = value.tracks.flatMap((t, lane) => t.clips.filter(c => selectedIds.includes(c.id)).map(clip => ({ clip: { ...clip }, lane }))); };
  const remove = (ripple = false) => { edit(Timeline.remove(value, selectedIds, ripple)); setSelected(''); setSelection([]); };
  const paste = (duplicate = false) => {
    if (duplicate) copy();
    const copied = clipboard.current;
    const next = Timeline.paste(value, copied, duplicate ? Math.max(0, ...copied.map(c => c.clip.start + c.clip.duration)) : time, duplicate ? Math.min(...copied.map(c => c.lane)) : activeLane);
    if (next === value) return;
    const old = new Set(value.tracks.flatMap(t => t.clips.map(c => c.id)));
    edit(next); const ids = next.tracks.flatMap(t => t.clips.filter(c => !old.has(c.id)).map(c => c.id)); setSelection(ids); setSelected(ids[0] ?? '');
  };
  const split = () => { let next = value; for (const id of selectedIds) next = Timeline.split(next, id, time); edit(next); };
  const selectionRange = () => { const clips = value.tracks.flatMap(t => t.clips.filter(c => selectedIds.includes(c.id))); return clips.length ? { start: Math.min(...clips.map(c => c.start)), end: Math.max(...clips.map(c => c.start + c.duration)) } : undefined; };
  const fitSelection = () => { const target = range ?? selectionRange(); if (!target) return; fitRange(target); };
  const selectAll = () => { setSelection(value.tracks.flatMap(t => t.clips.map(c => c.id))); setSelected(value.tracks.flatMap(t => t.clips)[0]?.id ?? ''); };
  const clearSelection = () => { finishGesture(false); setSelected(''); setSelection([]); setRange(undefined); };
  useTimelineShortcuts({ blocked: historyBlocked, restoreEdit, copy, paste: () => paste(), remove, selectAll, clearSelection });
  const { peaks, unavailable, waves } = useClipWaveforms({ value, zoom, suspended, audioSources, buffers });

  const clip = (trimPreview ?? value).tracks.flatMap(track => track.clips).find(c => c.id === selected);
  const generation = clip ? audioSources.get(Timeline.sourceKey(clip)) : undefined;
  const cueIndex = draft.subtitles?.cues.findIndex(c => c.id === generation?.segment?.cueId) ?? -1;
  const cue = draft.subtitles?.cues[cueIndex];
  const addTrack = () => edit({ ...value, tracks: [...value.tracks, { id: crypto.randomUUID(), name: t('@yovoice.timeline.track', { n: value.tracks.length + 1 }), muted: false, clips: [] }] });
  const append = (trackId: string, source: { duration: number; generationId?: string; assetId?: string }, asset?: AudioAsset) => {
    const current = latest.current;
    const lane = current.tracks.find(t => t.id === trackId);
    if (!lane) throw new Error('@yovoice.timeline.invalid');
    const start = Math.max(0, ...lane.clips.map(c => c.start + c.duration));
    if (current.tracks.reduce((sum, t) => sum + t.clips.length, 0) >= 2000 || source.duration < 0.01 || start + source.duration > 86400) throw new Error('@yovoice.timeline.invalid');
    if (asset && (current.assets?.length ?? 0) >= 2000) throw new Error('@yovoice.timeline.invalid');
    const nextClip: AudioClip = { id: crypto.randomUUID(), ...source, start, offset: 0 };
    edit({ ...current, assets: asset ? [...(current.assets ?? []), asset] : current.assets, tracks: current.tracks.map(t => t.id === trackId ? { ...t, clips: [...t.clips, nextClip] } : t) });
  };
  // 导入 yovoice 其他工程的生成：复制成资源后追加到音轨，成功即关闭对话框，失败抛给对话框在框内显示。
  const importGeneration = async (trackId: string, generation: Generation) => {
    stop(); uploadTrack.current = trackId; setImporting(true);
    try {
      const asset = await importTimelineGeneration(generation.id);
      if (!abort.current?.signal.aborted) { append(trackId, { assetId: asset.id, duration: asset.duration }, asset); setGenerationTrack(''); }
    } finally { setImporting(false); }
  };
  const selectClip = (c: AudioClip, event?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (event?.metaKey || event?.ctrlKey) setSelection(current => current.includes(c.id) ? current.filter(id => id !== c.id) : [...current, c.id]);
    else if (event?.shiftKey && selected) {
      const all = value.tracks.flatMap(t => [...t.clips].sort((a, b) => a.start - b.start));
      const a = all.findIndex(v => v.id === selected), b = all.findIndex(v => v.id === c.id);
      // 上一次选中的片段已不在时间线上时，范围无从算起，只选这一个。
      if (a < 0 || b < 0) setSelection([c.id]); else setSelection(all.slice(Math.min(a, b), Math.max(a, b) + 1).map(c => c.id));
    } else setSelection([c.id]);
    setSelected(c.id); setActiveLane(value.tracks.findIndex(t => t.clips.some(v => v.id === c.id)));

    const id = history.find(g => g.id === c.generationId)?.segment?.cueId;
    const index = draft.subtitles?.cues.findIndex(cue => cue.id === id) ?? -1;
    if (index >= 0) { cueFromClip.current = index; selectCue(index); }
  };
  // 只响应台词列表的选择；由选中片段反向同步的台词不再回跳。
  const followCue = useEffectEvent((selectedCue: number | undefined) => {
    if (selectedCue === undefined || cueFromClip.current === selectedCue) { cueFromClip.current = undefined; return; }
    const id = draft.subtitles?.cues[selectedCue]?.id;
    const linked = value.tracks.flatMap(t => t.clips).find(c => history.find(g => g.id === c.generationId)?.segment?.cueId === id);
    if (!linked) { setSelected(''); setSelection([]); return; }
    setSelected(linked.id); setSelection([linked.id]); seek(linked.start); setRange(undefined);
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-clip-id="${linked.id}"]`);
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  useEffect(() => followCue(selectedCue), [selectedCue, cueSelectionRevision]);
  const regenerateClip = async () => {
    if (!cue?.id || !clip || !editable || busy || exporting) return; stop(); setRegenerating(true);
    try { await regenerate(cue.id, clip.id); } catch (error) { onError(noticeMessage(error)); } finally { setRegenerating(false); }
  };
  // 可修改的快捷键：播放、试听选区、缩放与导出在整页响应（与原来的空格一致）；其余编辑、定位、轨道与吸附只在焦点位于时间线里时响应，
  // 不和同页面上同样按键的命令（如故事台词的重新生成）抢。对话框打开时由分发器挡下。
  const root = useRef<HTMLElement>(null);
  const playable = !suspended && !exporting && duration > 0;
  const hasRange = !!range || selectedIds.length > 0;
  const canRegenerate = !historyBlocked && editable && !!cue?.text.trim() && !exporting;
  const canExport = value.tracks.some(t => !t.muted && t.clips.length) && !exporting;
  const openExport = () => { stop(); setExportOpen(true); };
  // 带前后 1 秒试听选中的片段。
  const contextRange = () => { const r = selectionRange(); return r ? { start: Math.max(0, r.start - 1), end: Math.min(duration, r.end + 1) } : undefined; };
  // 试听类按键再按一次停止，而不是从头再播。
  const audition = (target?: { start: number; end: number }) => { if (playing || loading) stop(); else if (target) void play(target); };
  // 上一个、下一个片段边界：所有片段的起止点与时间线首尾，跳过当前位置 10 毫秒以内的点。
  const jumpEdge = (step: -1 | 1) => {
    const edges = [0, duration, ...value.tracks.flatMap(t => t.clips.flatMap(c => [c.start, c.start + c.duration]))];
    const target = step > 0 ? Math.min(...edges.filter(edge => edge > time + 0.01)) : Math.max(...edges.filter(edge => edge < time - 0.01));
    if (Number.isFinite(target)) seek(target);
  };
  // 静音、独奏当前轨：最近选中片段或点过的那条音轨。
  const lane = value.tracks[activeLane];
  const toggleLane = (field: 'muted' | 'solo') => { if (lane) edit({ ...value, tracks: value.tracks.map(t => t.id !== lane.id ? t : field === 'muted' ? { ...t, muted: !t.muted } : { ...t, solo: !t.solo }) }); };
  useHotkey('timeline.play', () => void play(), { enabled: playable });
  // 焦点在时间线里（例如刚点选了片段）时空格照常播放，不去激活片段按钮。
  useHotkey('timeline.play', () => void play(), { enabled: playable, within: root, onControl: true });
  useHotkey('timeline.playSelection', () => audition(range ?? selectionRange()), { enabled: playable && hasRange, within: root, onControl: true });
  useHotkey('global.playPause', () => void play(), { enabled: playable, inInput: true });
  useHotkey('timeline.playSelection', () => audition(range ?? selectionRange()), { enabled: playable && hasRange });
  useHotkey('timeline.preview', () => audition(contextRange()), { enabled: playable && selectedIds.length > 0, within: root });
  useHotkey('timeline.regenerate', () => void regenerateClip(), { enabled: canRegenerate, within: root });
  useHotkey('timeline.duplicate', () => paste(true), { enabled: !historyBlocked && editable, within: root });
  useHotkey('timeline.split', split, { enabled: !historyBlocked && editable, within: root });
  useHotkey('timeline.prevEdge', () => jumpEdge(-1), { enabled: !suspended && duration > 0, within: root, repeat: true });
  useHotkey('timeline.nextEdge', () => jumpEdge(1), { enabled: !suspended && duration > 0, within: root, repeat: true });
  useHotkey('timeline.start', () => seek(0), { enabled: !suspended, within: root });
  useHotkey('timeline.end', () => seek(duration), { enabled: !suspended, within: root });
  useHotkey('timeline.mute', () => toggleLane('muted'), { enabled: !historyBlocked && !!lane, within: root });
  useHotkey('timeline.solo', () => toggleLane('solo'), { enabled: !historyBlocked && !!lane, within: root });
  useHotkey('timeline.snap', () => setSnap(current => !current), { enabled: !suspended, within: root });
  useHotkey('timeline.zoomIn', () => zoomTo(zoom * 2), { enabled: !suspended && duration > 0, repeat: true });
  useHotkey('timeline.zoomOut', () => zoomTo(zoom / 2), { enabled: !suspended && duration > 0, repeat: true });
  useHotkey('timeline.zoomFit', fitAll, { enabled: !suspended && duration > 0 });
  useHotkey('timeline.zoomSelection', fitSelection, { enabled: !suspended && hasRange });
  useHotkey('timeline.export', openExport, { enabled: !suspended && canExport });
  const keys = {
    play: useHotkeyText('timeline.play'), playSelection: useHotkeyText('timeline.playSelection'), preview: useHotkeyText('timeline.preview'),
    regenerate: useHotkeyText('timeline.regenerate'), duplicate: useHotkeyText('timeline.duplicate'), split: useHotkeyText('timeline.split'),
    snap: useHotkeyText('timeline.snap'), export: useHotkeyText('timeline.export'),
    zoomIn: useHotkeyText('timeline.zoomIn'), zoomOut: useHotkeyText('timeline.zoomOut'), zoomFit: useHotkeyText('timeline.zoomFit'), zoomSelection: useHotkeyText('timeline.zoomSelection'),
  };
  const playAria = useHotkeyAria('timeline.play');
  const tip = (label: string, key: string) => withHotkey(label, key);
  const menuItems = [
    { type: 'section' as const, items: [
      { label: t('@yovoice.timeline.copy'), endContent: fixedKeys.copy, isDisabled: !selectedIds.length, onClick: copy },
      { label: t('@yovoice.timeline.paste'), endContent: fixedKeys.paste, isDisabled: !clipboard.current.length, onClick: () => paste() },
      { label: t('@yovoice.timeline.duplicate'), endContent: keys.duplicate || undefined, isDisabled: !editable, onClick: () => paste(true) },
      { label: t('@yovoice.timeline.split'), endContent: keys.split || undefined, isDisabled: !editable, onClick: split },
      { label: t('@yovoice.timeline.removeClip'), endContent: fixedKeys.remove, isDisabled: !editable, onClick: () => remove() },
      { label: t('@yovoice.timeline.regenerate'), endContent: keys.regenerate || undefined, isDisabled: !editable || !cue?.text.trim() || busy, onClick: () => void regenerateClip() },
      { label: t('@yovoice.timeline.rippleDelete'), endContent: fixedKeys.ripple, isDisabled: !editable, onClick: () => remove(true) },
    ] },
    { type: 'section' as const, items: [
      { label: t('@yovoice.timeline.audition'), endContent: keys.playSelection || undefined, isDisabled: !hasRange, onClick: () => void play(range ?? selectionRange()) },
      { label: t('@yovoice.timeline.contextPlay'), endContent: keys.preview || undefined, isDisabled: !selectedIds.length, onClick: () => { const r = contextRange(); if (r) void play(r); } },
      { label: t('@yovoice.timeline.snap'), endContent: keys.snap || undefined, onClick: () => setSnap(!snap) },
      { label: t('@yovoice.player.zoomFit'), endContent: keys.zoomFit || undefined, onClick: fitAll },
      { label: t('@yovoice.timeline.fitSelection'), endContent: keys.zoomSelection || undefined, isDisabled: !hasRange, onClick: fitSelection },
      ...(isDesktop ? [{ label: t('@yovoice.timeline.package'), onClick: () => void exportProject().catch(e => onError(noticeMessage(e))) }] : []),
      { label: t('@yovoice.timeline.balance'), isDisabled: !duration, onClick: () => void (async () => { try { const audio = context.current ??= new AudioContext(); for (const c of value.tracks.flatMap(t => t.clips)) await load(Timeline.sourceKey(c), audio); edit(Timeline.balance(value, history, buffers.current)); } catch (e) { onError(noticeMessage(e)); } })() },
    ] },
  ];
  // 片段与空隙手柄共用的时间线上下文。
  const clipShared: ClipSharedProps = { t, value, history, draft, audioSources, scale, time, snap, selectedIds, blocked: historyBlocked, peaks, waves, unavailable, selectClip, gestures, seek, setRange, edit };
  // 菜单打开时 Esc 交给菜单关闭：macOS 上右键菜单打开后焦点可能仍在剪辑上，不能在这里拦下。
  // tabIndex=-1：点时间线空白处时焦点落到时间线上，只在时间线里响应的快捷键随即可用。
  return <VStack as="footer" ref={root} tabIndex={-1} className="multitrack audio-panel" gap={0} style={{ height: panel.size }} onKeyDown={e => {
    if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element).closest('[role=menu], [role=dialog], dialog, [aria-modal="true"]') && !document.querySelector('[role=menu]') && !exportOpen && !historyTrack && !generationTrack) { clearSelection(); e.stopPropagation(); }
  }}>
    <input ref={input} type="file" hidden accept="audio/*,.aac,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aiff,.aif,.wma,.webm" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      const trackId = uploadTrack.current;
      stop(); setImporting(true);
      try {
        const asset = await importTimelineFile(file);
        if (!abort.current?.signal.aborted) append(trackId, { assetId: asset.id, duration: asset.duration }, asset);
      } catch (error) { onError(importError(error)); }
      finally { setImporting(false); }
    }} />
    {historyTrack ? <HistoryImportDialog key={historyTrack} trackId={historyTrack} draft={draft} history={history} append={append} onClose={() => setHistoryTrack('')} /> : null}
    {generationTrack ? <GenerationImportDialog key={generationTrack} trackId={generationTrack} draft={draft} drafts={drafts} history={history} importing={importing} importGeneration={importGeneration} onClose={() => setGenerationTrack('')} /> : null}
    <ResizeHandle label={t('@yovoice.timeline.resize')} direction="vertical" pillPlacement="center" isReversed resizable={panel.props} />
    <PlaybackToolbar time={time} duration={duration} playing={playing} disabled={!duration || suspended || exporting} loading={loading} toggle={() => void play()} keys={keys.play} aria={playAria}>
      <Button size="sm" variant="ghost" isIconOnly icon={<Undo2 />} label={t('@yovoice.timeline.undo')} tooltip={`${t('@yovoice.timeline.undo')} (${fixedKeys.undo})`} aria-keyshortcuts={fixedKeys.undoAria} isDisabled={historyBlocked || !!trimPreview || !edits.canUndo} onClick={() => restoreEdit('undo')} />
      <Button size="sm" variant="ghost" isIconOnly icon={<Redo2 />} label={t('@yovoice.timeline.redo')} tooltip={`${t('@yovoice.timeline.redo')} (${fixedKeys.redo})`} aria-keyshortcuts={fixedKeys.redoAria} isDisabled={historyBlocked || !!trimPreview || !edits.canRedo} onClick={() => restoreEdit('redo')} />
      <Button className="timeline-extra" size="sm" variant="ghost" isIconOnly tooltip={tip(t('@yovoice.timeline.split'), keys.split)} label={t('@yovoice.timeline.split')} icon={<Scissors />} isDisabled={!editable || !clip || time - clip.start < 0.01 || clip.start + clip.duration - time < 0.01} onClick={split} />
      <Button className="timeline-extra" size="sm" variant="ghost" isIconOnly tooltip={t('@yovoice.timeline.removeClip')} label={t('@yovoice.timeline.removeClip')} icon={<Trash2 />} isDisabled={!editable} onClick={() => remove()} />
      <Button className="timeline-extra" size="sm" variant="ghost" isIconOnly icon={<RefreshCw />} label={t('@yovoice.timeline.regenerate')} tooltip={tip(t('@yovoice.timeline.regenerate'), keys.regenerate)} isLoading={regenerating} isDisabled={!editable || !cue?.text.trim() || busy || exporting} onClick={() => void regenerateClip()} />
      <Button size="sm" label={t('@yovoice.timeline.export')} tooltip={keys.export ? tip(t('@yovoice.timeline.export'), keys.export) : undefined} isDisabled={!canExport} onClick={openExport} />
      <Button className="timeline-extra timeline-snap-toggle" size="sm" variant={snap ? "secondary" : "ghost"} isIconOnly label={t('@yovoice.timeline.snap')} tooltip={`${tip(t('@yovoice.timeline.snap'), keys.snap)} · ${fixedKeys.noSnap}`} icon={<Magnet />} aria-pressed={snap} onClick={() => setSnap(!snap)} />
      <DropdownMenu presentation="popover" placement="above" hasChevron={false} menuWidth="max-content" button={{ size: 'sm', variant: 'ghost', isIconOnly: true, label: t('@yovoice.timeline.more'), icon: <MoreHorizontal />, 'data-timeline-more': 'true' }} items={menuItems} />
      <TrackZoom value={zoom} change={zoomTo} fit={fitAll} disabled={!duration} min={minZoom} max={32} keys={{ out: keys.zoomOut, fit: keys.zoomFit, in: keys.zoomIn }} />
    </PlaybackToolbar>
    <TimelineExportDialog open={exportOpen} value={value} history={history} draft={draft} range={range} context={context} load={load} exporting={exporting} setExporting={setExporting} onClose={() => setExportOpen(false)} />
    <ContextMenu items={menuItems} size="sm" menuWidth="max-content" label={t('@yovoice.timeline.more')} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    <VStack ref={scrollRef} className="multitrack-scroll" gap={0} {...pointerHandlers} onContextMenu={e => {
      const id = (e.target as Element).closest('[data-clip-id]')?.getAttribute('data-clip-id');
      const target = value.tracks.flatMap(t => t.clips).find(c => c.id === id);
      if (target && !selectedIds.includes(target.id)) selectClip(target);
    }} onPointerDown={e => {
      if (!(e.target as Element).closest('button, input, [role="slider"], [role="menuitem"]')) { setSelected(''); setSelection([]); }
    }}>
      <VStack className="multitrack-content" gap={0} style={{ minWidth: '100%', width: `calc(var(--audio-label-width) + (100% - var(--audio-label-width)) * ${zoom * scale / 10})` }}>
        <HStack gap={0} className="multitrack-ruler-row">
          <small className="multitrack-label">{t('@yovoice.timeline.tracks')}</small>
          <VStack ref={rulerRef} className="multitrack-ruler" gap={0} onPointerDown={e => {
            if ((e.target as Element).closest('button')) return;
            const rect = e.currentTarget.getBoundingClientRect(), start = Math.max(0, Math.min(scale, (e.clientX - rect.left) / rect.width * scale));
            seek(start); setRange(undefined);
            beginGesture(e, dx => { const end = Math.max(0, Math.min(scale, start + dx / rect.width * scale)); setRange({ start: Math.min(start, end), end: Math.max(start, end) }); });
          }}>
            <HStack gap={0} aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>{Array.from({ length: Math.max(0, tickCount) }, (_, offset) => { const i = firstTick + offset; return <small className="timeline-tick" style={{ left: `${i * tickStep / scale * 100}%` }} key={i}>{Number((i * tickStep).toFixed(2))}s</small>; })}</HStack>
            {range ? <i className="timeline-range" style={{ left: `${range.start / scale * 100}%`, width: `${(range.end - range.start) / scale * 100}%` }} /> : null}
            <i className="multitrack-playhead" aria-hidden="true" style={{ left: `${Math.min(time, scale) / scale * 100}%` }} />
            <input type="range" aria-label={t('@yovoice.player.progress')} min={0} max={scale} step={0.01} value={Math.min(time, scale)} tabIndex={0} onChange={e => { setRange(undefined); seek(Number(e.target.value)); }} />
          </VStack>
        </HStack>
        {(trimPreview ?? value).tracks.map(track => <HStack key={track.id} className="multitrack-row" gap={0}>
          <TrackHeader t={t} track={track} value={value} edit={edit} />
          <VStack className="multitrack-lane" gap={0} aria-label={track.name} data-lane-id={track.id} onPointerDown={e => {
            if (e.target !== e.currentTarget) return;
            setSelected(''); setSelection([]); setRange(undefined);
            setActiveLane(value.tracks.findIndex(t => t.id === track.id));
            const rect = e.currentTarget.getBoundingClientRect(), start = (e.clientX - rect.left) / rect.width * scale;
            beginGesture(e, (dx, dy) => {
              const end = start + dx / rect.width * scale, rowHeight = rect.height;
              const lane = value.tracks.findIndex(t => t.id === track.id), other = Math.max(0, Math.min(value.tracks.length - 1, lane + Math.round(dy / rowHeight)));
              setSelection(value.tracks.slice(Math.min(lane, other), Math.max(lane, other) + 1).flatMap(t => t.clips.filter(c => c.start < Math.max(start, end) && c.start + c.duration > Math.min(start, end)).map(c => c.id)));
              setRange({ start: Math.max(0, Math.min(start, end)), end: Math.max(start, end) });
            }, start);
          }}>
            {track.clips.map(c => <ClipRegion key={c.id} clip={c} track={track} {...clipShared} />)}
            {[...track.clips].sort((a, b) => a.start - b.start).map((c, i, clips) => {
              const end = Math.max(0, ...clips.slice(0, i).map(v => v.start + v.duration)), gap = c.start - end;
              return gap > 0.01 ? <GapHandle key={`gap-${c.id}`} clip={c} gap={gap} end={end} track={track} {...clipShared} /> : null;
            })}
            {guide !== undefined ? <i className="timeline-snap-guide" style={{ left: `${guide / scale * 100}%` }} /> : null}
            {range ? <i className="timeline-range" style={{ left: `${range.start / scale * 100}%`, width: `${(range.end - range.start) / scale * 100}%` }} /> : null}
            <i className="multitrack-playhead" aria-hidden="true" style={{ left: `${Math.min(time, scale) / scale * 100}%` }} />
            <HStack className="multitrack-add-audio" gap={0} style={{ left: `calc(${Math.max(0, ...track.clips.map(c => c.start + c.duration)) / scale * 100}% + var(--spacing-2))` }}>
              <DropdownMenu className="timeline-audio-menu" presentation="popover" placement="above" alignment="start" hasChevron={false} menuWidth="max-content"
                button={{ size: 'sm', variant: 'secondary', className: 'timeline-audio-button', icon: <FileAudio />, label: t('@yovoice.timeline.audio'), 'aria-label': t('@yovoice.timeline.importTo', { name: track.name }), isLoading: importing && uploadTrack.current === track.id, isDisabled: importing || track.locked }}
                items={[
                  { label: t('@yovoice.timeline.upload'), icon: Upload, onClick: () => { uploadTrack.current = track.id; input.current?.click(); } },
                  { label: t('@yovoice.timeline.fromYovoice'), icon: AudioLines, onClick: () => { stop(); setGenerationTrack(track.id); } },
                  ...(projectKind(draft) === 'text' ? [{ label: t('@yovoice.timeline.fromHistory'), icon: History, onClick: () => { stop(); setHistoryTrack(track.id); } }] : []),
                ]} />
            </HStack>
          </VStack>
        </HStack>)}
        <HStack gap={0}>
          <HStack className="multitrack-label" gap={0}>
            <Button size="sm" variant="secondary" label={t('@yovoice.timeline.add')} icon={<Plus />} isDisabled={value.tracks.length >= 32} onClick={addTrack} />
          </HStack>
        </HStack>
      </VStack>
    </VStack>
    </ContextMenu>
  </VStack>;
}
