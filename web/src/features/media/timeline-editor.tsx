import { PlaybackToolbar, TrackZoom } from './playback-toolbar';
import { formatNotice } from '../../shared/i18n/format';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useReducer, type PointerEvent as ReactPointerEvent } from 'react';
import { Popover } from '@astryxdesign/core/Popover';
import { Selector } from '../../shared/selector';
import { AudioLevel } from './audio-level';
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ResizeHandle } from '@astryxdesign/core/Resizable';
import { useAudioPanel } from './use-audio-panel';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Upload, History, FileAudio, Plus, Scissors, Trash2, Volume2, VolumeX, RefreshCw, GripVertical, Undo2, Redo2, Magnet, MoreHorizontal, Lock, Unlock, Headphones, SlidersHorizontal } from 'lucide-react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { SpeakerAvatar } from '../create/subtitles';
import { encodeWav } from '../../shared/lib/sound';
import { isDesktop, mediaUrl, saveAudio, importTimelineFile } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatTime, projectKind, type AudioLane, type AudioAsset, type AudioClip, type AudioTimeline, type Generation, type Draft } from '../../shared/workbench';
import { Timeline, TimelineHistory } from './timeline';

export function TimelineEditor({ draft, busy, regenerate, exportProject, selectCue, selectedCue, cueSelectionRevision, playbackCue, value, history, change, suspended, onError }: {
  exportProject: () => Promise<void>; cueSelectionRevision?: number; selectedCue?: number; playbackCue?: (index: number) => void; draft: Draft; busy: boolean; regenerate: (cueId: string, clipId: string) => Promise<void>; selectCue: (index: number) => void;
  value: AudioTimeline; history: Generation[]; change: (value: AudioTimeline) => void; suspended: boolean; onError: (message: string) => void;
}) {
  const t = useTranslator();
  const panel = useAudioPanel(value.tracks.length > 0, 'audio-multitrack-height');
  const input = useRef<HTMLInputElement>(null);
  const uploadTrack = useRef('');
  const latest = useRef(value);
  latest.current = value;
  const [importing, setImporting] = useState(false);
  const [historyTrack, setHistoryTrack] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [snap, setSnap] = useState(true);
  const [guide, setGuide] = useState<number>();
  const [range, setRange] = useState<{ start: number; end: number }>();
  const [activeLane, setActiveLane] = useState(0);
  const clipboard = useRef<{ clip: AudioClip; lane: number }[]>([]);
  const scrollRef = useRef<HTMLElement>(null);
  const rulerRef = useRef<HTMLElement>(null);
  const gesture = useRef<{ x: number; y: number; clientX: number; clientY: number; alt: boolean; scroll: number; vertical: number; moved: boolean; raf: number; clickTime?: number; apply: (x: number, y: number, alt: boolean) => void } | null>(null);
  const gestureNext = useRef<AudioTimeline | null>(null);
  const cueFromClip = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const zoomAnchor = useRef<{ time: number; x: number } | null>(null);
  const [exportScope, setExportScope] = useState('all');
  const [preventClipping, setPreventClipping] = useState(true);
  const [peakDb, setPeakDb] = useState<number>();

  const [edits] = useState(() => new TimelineHistory(value));
  const [, refreshEdits] = useReducer(count => count + 1, 0);
  const [trimPreview, setTrimPreview] = useState<AudioTimeline | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportName, setExportName] = useState(draft.title);
  const [exportError, setExportError] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [zoom, setZoom] = useState(1);
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const frame = useRef(0);
  const operation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const duration = Timeline.duration(value);
  // 100% 默认显示十秒，长工程横向延展；增加片段不压缩已有片段。
  const [extent, setExtent] = useState(() => Math.max(duration * 1.2 + 2, 10));
  const scale = extent;
  const fitExtent = Math.max(duration * 1.2 + 2, 10);
  const minZoom = 10 / fitExtent;
  const fitAll = () => { zoomAnchor.current = null; setExtent(fitExtent); setZoom(minZoom); if (scrollRef.current) scrollRef.current.scrollLeft = 0; };
  useEffect(() => { if (duration > extent - 1) setExtent(Math.max(duration * 1.2 + 2, 10)); }, [duration, extent]);
  const zoomTo = (next: number, anchorX?: number) => {
    const ruler = rulerRef.current?.getBoundingClientRect(), scroll = scrollRef.current?.getBoundingClientRect();
    if (ruler && scroll) { const x = anchorX ?? scroll.left + scroll.width / 2; zoomAnchor.current = { time: (x - ruler.left) / ruler.width * scale, x }; }
    setZoom(Math.max(minZoom, Math.min(32, next)));
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current, ruler = rulerRef.current, scroll = scrollRef.current;
    if (anchor && ruler && scroll) { scroll.scrollLeft += ruler.getBoundingClientRect().left + anchor.time / scale * ruler.clientWidth - anchor.x; zoomAnchor.current = null; }
  }, [zoom, scale]);
  useEffect(() => { const element = scrollRef.current; if (!element) return; const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX); } }; element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel); });
  const [rulerWidth, setRulerWidth] = useState(1000);
  const [viewport, setViewport] = useState({ left: 0, width: 1000 });
  useEffect(() => {
    const ruler = rulerRef.current, scroll = scrollRef.current; if (!ruler || !scroll) return;
    const measure = () => { setRulerWidth(Math.max(1, ruler.clientWidth)); setViewport({ left: scroll.scrollLeft, width: scroll.clientWidth }); };
    const observer = new ResizeObserver(measure); observer.observe(ruler); observer.observe(scroll);
    scroll.addEventListener('scroll', measure, { passive: true }); measure();
    return () => { observer.disconnect(); scroll.removeEventListener('scroll', measure); };
  }, []);
  const tickStep = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1800, 3600, 7200].find(step => step / scale * rulerWidth >= 70) ?? 7200;

  // 标尺只绘制可见区，长工程放大后也不创建成千上万个刻度。
  const firstTick = Math.max(0, Math.floor(viewport.left / rulerWidth * scale / tickStep) - 1);
  const tickCount = Math.min(Math.floor(scale / tickStep) - firstTick + 1, Math.ceil(viewport.width / rulerWidth * scale / tickStep) + 3);

  const clip = (trimPreview ?? value).tracks.flatMap(track => track.clips).find(c => c.id === selected);
  const audioSources = new Map<string, { title: string; duration: number; fileName: string; segment?: Generation['segment'] }>([
    ...history.map(g => [g.id, g] as const),
    ...(value.assets ?? []).map(asset => [`asset:${asset.id}`, { ...asset, title: asset.name }] as const),
  ]);
  const generation = clip ? audioSources.get(Timeline.sourceKey(clip)) : undefined;
  const cueIndex = draft.subtitles?.cues.findIndex(c => c.id === generation?.segment?.cueId) ?? -1;
  const cue = draft.subtitles?.cues[cueIndex];
  const stop = () => {
    operation.current++;
    cancelAnimationFrame(frame.current);
    for (const source of sources.current) { source.stop(); source.disconnect(); }
    sources.current = [];
    setPlaying(false); setLoading(false); playbackCue?.(-1);
  };
  // 卸载时释放播放节点、拖动帧、解码缓存与音频上下文。
  const release = useEffectEvent(() => {
    operation.current++; cancelAnimationFrame(frame.current); abort.current?.abort();
    if (gesture.current) cancelAnimationFrame(gesture.current.raf); gesture.current = null;
    for (const source of sources.current) { source.stop(); source.disconnect(); }
    sources.current = []; buffers.current.clear();
    const current = context.current; context.current = null;
    if (current) void current.close();
  });
  useEffect(() => {
    abort.current = new AbortController();
    return () => release();
  }, []);
  // 暂停或时间线被外部替换时，中止播放与未完成的拖动。
  const halt = useEffectEvent(() => { stop(); finishGesture(false); });
  const recordEdit = useEffectEvent((next: AudioTimeline) => { if (edits.record(next, selected)) refreshEdits(); });
  useEffect(() => { if (suspended) halt(); }, [suspended]);
  useEffect(() => { halt(); setTrimPreview(null); recordEdit(value); }, [value]);
  const edit = (next: AudioTimeline) => {
    if (!edits.record(next, selected)) return;
    stop(); refreshEdits(); change(next);
  };
  const historyBlocked = suspended || importing || exporting || regenerating || busy || !!historyTrack || exportOpen;
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
  const selectedIds = selection;
  const editable = selectedIds.length > 0 && !value.tracks.some(t => t.locked && t.clips.some(c => selectedIds.includes(c.id)));
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
  const fitSelection = () => { const target = range ?? selectionRange(); if (!target) return; zoomAnchor.current = { time: target.start, x: (scrollRef.current?.getBoundingClientRect().left ?? 0) + (scrollRef.current?.querySelector('.multitrack-label')?.clientWidth ?? 0) }; setZoom(Math.min(32, Math.max(minZoom, 10 / (target.end - target.start) * 0.8))); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (historyBlocked || event.defaultPrevented || event.isComposing || event.altKey) return;
      if ((event.target as Element)?.closest('textarea, input:not([type="range"]), select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"]') || Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(e => e.getClientRects().length > 0)) return;
      const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
      if (key === ' ' && !command) { event.preventDefault(); void play(); return; }
      if (command && (key === 'z' || key === 'y')) { event.preventDefault(); restoreEdit(key === 'y' || event.shiftKey ? 'redo' : 'undo'); return; }
      if (!(event.target as Element)?.closest('.multitrack')) return;
      if (command && key === 'c') { event.preventDefault(); copy(); }
      else if (command && key === 'v') { event.preventDefault(); paste(); }
      else if (command && key === 'd') { event.preventDefault(); paste(true); }
      else if (command && key === 'a') { event.preventDefault(); setSelection(value.tracks.flatMap(t => t.clips.map(c => c.id))); setSelected(value.tracks.flatMap(t => t.clips)[0]?.id ?? ''); }
      else if (command && key === 'i') { event.preventDefault(); split(); }
      else if (key === 'delete' || key === 'backspace') { event.preventDefault(); remove(event.shiftKey); }
      else if (key === 'home') { event.preventDefault(); seek(0); }
      else if (key === 'end') { event.preventDefault(); seek(duration); }
      else if (key === 'escape') { finishGesture(false); setSelected(''); setSelection([]); setRange(undefined); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const load = async (id: string, audio: AudioContext): Promise<AudioBuffer> => {
    const cached = buffers.current.get(id);
    if (cached) return cached;
    const generation = audioSources.get(id);
    if (!generation) throw new Error('@yovoice.error.audioMissing');
    const url = await mediaUrl('outputs', generation.fileName);
    try {
      const response = await fetch(url, { signal: abort.current?.signal });
      if (!response.ok) throw new Error('@yovoice.error.audioReadFailed');
      const buffer = await audio.decodeAudioData(await response.arrayBuffer());
      buffers.current.set(id, buffer);
      return buffer;
    } finally { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }
  };
  const sourceIds = [...new Set(value.tracks.flatMap(track => track.clips.map(c => Timeline.sourceKey(c))))].sort().join(',');
  // 波形只随音频源与缩放级别重算，加载与报错使用最新的回调。
  const loadSource = useEffectEvent((id: string, audio: AudioContext) => load(id, audio));
  const reportError = useEffectEvent((message: string) => onError(message));
  useEffect(() => {
    let active = true;
    const audio = context.current ??= new AudioContext();
    void (async () => {
      for (const id of sourceIds.split(',').filter(Boolean)) {
        try {
          const buffer = await loadSource(id, audio);
          if (!active) return;
          const samples = buffer.getChannelData(0);
          const stride = Math.max(1, Math.ceil(samples.length / (400 * zoom)));
          const waveform = Array.from({ length: 400 * zoom }, (_, index) => {
            let peak = 0;
            for (let n = index * stride; n < Math.min(samples.length, (index + 1) * stride); n++) peak = Math.max(peak, Math.abs(samples[n]));
            return peak;
          });
          setPeaks(previous => ({ ...previous, [id]: waveform }));
        } catch (error) { if (active) reportError((error as Error).message); }
      }
    })();
    return () => { active = false; };
  }, [sourceIds, zoom]);
  const play = async (audition?: { start: number; end: number }) => {
    if (playing || loading) { stop(); if (!audition) return; }
    const token = ++operation.current;
    setLoading(true);
    try {
      const audio = context.current ??= new AudioContext();
      await audio.resume();
      if (token !== operation.current) return;
      const target = audition ?? range;
      const from = target?.start ?? (time >= duration ? 0 : time);
      const to = target?.end ?? duration;
      const clips = Timeline.audible(value).flatMap(track => track.clips).filter(c => c.start + c.duration > from && c.start < to);
      // 先解码全部源，再共用同一时钟启动，避免音轨随加载速度错位。
      for (const id of new Set(clips.map(c => Timeline.sourceKey(c)))) {
        await load(id, audio);
        if (token !== operation.current) return;
      }
      const start = audio.currentTime + 0.05;
      const nodes = Timeline.schedule(audio, value, buffers.current, from, to, start);
      for (const node of nodes) { const cleanup = node.onended; node.onended = event => { cleanup?.call(node, event); sources.current = sources.current.filter(s => s !== node); }; }
      sources.current.push(...nodes);
      setLoading(false); setPlaying(true);
      const tick = () => {
        const next = Math.min(to, from + Math.max(0, audio.currentTime - start));
        setTime(next);
        const active = clips.find(c => c.start <= next && c.start + c.duration > next);
        const id = history.find(g => g.id === active?.generationId)?.segment?.cueId;
        playbackCue?.(draft.subtitles?.cues.findIndex(c => c.id === id) ?? -1);
        if (next >= to) stop();
        else frame.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) { if (token === operation.current) { stop(); onError((error as Error).message); } }
  };
  const seek = (next: number) => { stop(); setTime(next); };
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
  const selectClip = (c: AudioClip, event?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (event?.metaKey || event?.ctrlKey) setSelection(current => current.includes(c.id) ? current.filter(id => id !== c.id) : [...current, c.id]);
    else if (event?.shiftKey && selected) {
      const all = value.tracks.flatMap(t => [...t.clips].sort((a, b) => a.start - b.start));
      const a = all.findIndex(v => v.id === selected), b = all.findIndex(v => v.id === c.id);
      setSelection(all.slice(Math.min(a, b), Math.max(a, b) + 1).map(c => c.id));
    } else setSelection([c.id]);
    setSelected(c.id); setActiveLane(value.tracks.findIndex(t => t.clips.some(v => v.id === c.id)));

    const id = history.find(g => g.id === c.generationId)?.segment?.cueId;
    const index = draft.subtitles?.cues.findIndex(cue => cue.id === id) ?? -1;
    if (index >= 0) { cueFromClip.current = index; selectCue(index); }
  };
  const finishGesture = (commit: boolean) => {
    if (gesture.current) {
      cancelAnimationFrame(gesture.current.raf); suppressClick.current = gesture.current.moved;
      if (commit && !gesture.current.moved && gesture.current.clickTime !== undefined) { seek(gesture.current.clickTime); setRange(undefined); }
    }
    gesture.current = null; setTrimPreview(null); setGuide(undefined);
    const next = gestureNext.current; gestureNext.current = null;
    if (commit && next) edit(next);
  };
  const preview = (next: AudioTimeline) => { gestureNext.current = next; setTrimPreview(next); };
  const beginGesture = (event: ReactPointerEvent<HTMLElement>, apply: (x: number, y: number, alt: boolean) => void, clickTime?: number) => {
    if (event.button !== 0 || historyBlocked) return;
    event.preventDefault(); event.stopPropagation(); stop(); event.currentTarget.focus({ preventScroll: true });
    const scroll = scrollRef.current!; scroll.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, alt: event.altKey, scroll: scroll.scrollLeft, vertical: scroll.scrollTop, moved: false, raf: 0, clickTime, apply };
    const tick = () => {
      const g = gesture.current; if (!g) return;
      const rect = scroll.getBoundingClientRect();
      if (g.moved) {
        const margin = 32, label = scroll.querySelector('.multitrack-label')?.clientWidth ?? 0;
        scroll.scrollLeft += g.clientX > rect.right - margin ? (g.clientX - rect.right + margin) / 3 : g.clientX < rect.left + label + margin ? (g.clientX - rect.left - label - margin) / 3 : 0;
        scroll.scrollTop += g.clientY > rect.bottom - margin ? 6 : g.clientY < rect.top + margin ? -6 : 0;
        g.apply(g.clientX - g.x + scroll.scrollLeft - g.scroll, g.clientY - g.y + scroll.scrollTop - g.vertical, g.alt);
      }
      g.raf = requestAnimationFrame(tick);
    }; tick();
  };
  const moveGesture = (e: ReactPointerEvent<HTMLElement>) => { const g = gesture.current; if (!g) return; g.clientX = e.clientX; g.clientY = e.clientY; g.alt = e.altKey; g.moved ||= Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 3; if (g.moved) g.apply(e.clientX - g.x + scrollRef.current!.scrollLeft - g.scroll, e.clientY - g.y + scrollRef.current!.scrollTop - g.vertical, e.altKey); };
  const pointerHandlers = { onPointerMove: moveGesture, onPointerUp: () => finishGesture(true), onPointerCancel: () => finishGesture(false), onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => { if (e.target === e.currentTarget) finishGesture(false); } };
  const updateTrack = (id: string, patch: Partial<AudioLane>) => edit({ ...value, tracks: value.tracks.map(t => t.id === id ? { ...t, ...patch } : t) });
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
    try { await regenerate(cue.id, clip.id); } catch (error) { onError((error as Error).message); } finally { setRegenerating(false); }
  };
  const menuItems = [
    { type: 'section' as const, items: [
      { label: t('@yovoice.timeline.copy'), endContent: '⌘/Ctrl+C', isDisabled: !selectedIds.length, onClick: copy },
      { label: t('@yovoice.timeline.paste'), endContent: '⌘/Ctrl+V', isDisabled: !clipboard.current.length, onClick: () => paste() },
      { label: t('@yovoice.timeline.duplicate'), endContent: '⌘/Ctrl+D', isDisabled: !editable, onClick: () => paste(true) },
      { label: t('@yovoice.timeline.split'), endContent: '⌘/Ctrl+I', isDisabled: !editable, onClick: split },
      { label: t('@yovoice.timeline.removeClip'), endContent: 'Delete', isDisabled: !editable, onClick: () => remove() },
      { label: t('@yovoice.timeline.regenerate'), isDisabled: !editable || !cue?.text.trim() || busy, onClick: () => void regenerateClip() },
      { label: t('@yovoice.timeline.rippleDelete'), endContent: 'Shift+Delete', isDisabled: !editable, onClick: () => remove(true) },
    ] },
    { type: 'section' as const, items: [
      { label: t('@yovoice.timeline.audition'), isDisabled: !range && !selectedIds.length, onClick: () => void play(range ?? selectionRange()) },
      { label: t('@yovoice.timeline.contextPlay'), isDisabled: !selectedIds.length, onClick: () => { const r = selectionRange(); if (r) void play({ start: Math.max(0, r.start - 1), end: Math.min(duration, r.end + 1) }); } },
      { label: t('@yovoice.timeline.snap'), onClick: () => setSnap(!snap) },
      { label: t('@yovoice.player.zoomFit'), onClick: fitAll },
      { label: t('@yovoice.timeline.fitSelection'), isDisabled: !range && !selectedIds.length, onClick: fitSelection },
      ...(isDesktop ? [{ label: t('@yovoice.timeline.package'), onClick: () => void exportProject().catch(e => onError(noticeMessage(e))) }] : []),
      { label: t('@yovoice.timeline.balance'), isDisabled: !duration, onClick: () => void (async () => { try { const audio = context.current ??= new AudioContext(); for (const c of value.tracks.flatMap(t => t.clips)) await load(Timeline.sourceKey(c), audio); edit(Timeline.balance(value, history, buffers.current)); } catch (e) { onError((e as Error).message); } })() },
    ] },
  ];
  // 菜单打开时 Esc 交给菜单关闭：macOS 上右键菜单打开后焦点可能仍在剪辑上，不能在这里拦下。
  return <VStack as="footer" className="multitrack audio-panel" gap={0} style={{ height: panel.size }} onKeyDown={e => {
    if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element).closest('[role=menu], [role=dialog]') && !document.querySelector('[role=menu]') && !exportOpen && !historyTrack) { finishGesture(false); setSelected(''); setSelection([]); setRange(undefined); e.stopPropagation(); }
  }}>
    <input ref={input} type="file" hidden accept="audio/*,.aac,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aiff,.aif,.wma,.webm" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      const trackId = uploadTrack.current;
      stop(); setImporting(true);
      try {
        const asset = await importTimelineFile(file);
        if (!abort.current?.signal.aborted) append(trackId, { assetId: asset.id, duration: asset.duration }, asset);
      } catch (error) { onError((error as Error).name === 'EncodingError' ? '@yovoice.error.browserDecode' : (error as Error).message); }
      finally { setImporting(false); }
    }} />
    {historyTrack ? <AppDialog title={t('@yovoice.timeline.fromHistory')} onClose={() => setHistoryTrack('')}>
      <TextInput label={t('@yovoice.timeline.searchHistory')} isLabelHidden placeholder={t('@yovoice.timeline.searchHistory')} value={historyQuery} onChange={setHistoryQuery} hasClear />
      <VStack className="timeline-history-list" gap={1}>
        {history.filter(g => projectKind(draft) === 'text' && !g.segment && g.settings.id === draft.id && g.title.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase())).map(g => <HStack key={g.id} gap={2} vAlign="center">
          <Button className="grow text-left" variant="ghost" label={g.title} onClick={() => {
            try { append(historyTrack, { generationId: g.id, duration: g.duration }); setHistoryTrack(''); }
            catch (error) { onError((error as Error).message); }
          }} /><small className="muted">{formatTime(g.duration)} · {new Date(g.createdAt).toLocaleString()}</small>
        </HStack>)}
        {!history.some(g => projectKind(draft) === 'text' && !g.segment && g.settings.id === draft.id && g.title.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase())) ? <p className="muted">{t('@yovoice.timeline.noHistory')}</p> : null}
      </VStack>
    </AppDialog> : null}
    <ResizeHandle label={t('@yovoice.timeline.resize')} direction="vertical" pillPlacement="center" isReversed resizable={panel.props} />
    <PlaybackToolbar time={time} duration={duration} playing={playing} disabled={!duration || suspended || exporting} loading={loading} toggle={() => void play()}>
      <Button size="sm" variant="ghost" isIconOnly icon={<Undo2 />} label={t('@yovoice.timeline.undo')} tooltip={`${t('@yovoice.timeline.undo')} (⌘/Ctrl+Z)`} aria-keyshortcuts="Meta+Z Control+Z" isDisabled={historyBlocked || !!trimPreview || !edits.canUndo} onClick={() => restoreEdit('undo')} />
      <Button size="sm" variant="ghost" isIconOnly icon={<Redo2 />} label={t('@yovoice.timeline.redo')} tooltip={`${t('@yovoice.timeline.redo')} (⌘/Ctrl+Shift+Z)`} aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y" isDisabled={historyBlocked || !!trimPreview || !edits.canRedo} onClick={() => restoreEdit('redo')} />
      <Button className="timeline-extra" size="sm" variant="ghost" isIconOnly tooltip={t('@yovoice.timeline.split')} label={t('@yovoice.timeline.split')} icon={<Scissors />} isDisabled={!editable || !clip || time - clip.start < 0.01 || clip.start + clip.duration - time < 0.01} onClick={split} />
      <Button className="timeline-extra" size="sm" variant="ghost" isIconOnly tooltip={t('@yovoice.timeline.removeClip')} label={t('@yovoice.timeline.removeClip')} icon={<Trash2 />} isDisabled={!editable} onClick={() => remove()} />
      <Button className="timeline-extra" size="sm" variant="ghost" isIconOnly icon={<RefreshCw />} label={t('@yovoice.timeline.regenerate')} tooltip={t('@yovoice.timeline.regenerate')} isLoading={regenerating} isDisabled={!editable || !cue?.text.trim() || busy || exporting} onClick={() => void regenerateClip()} />
      <Button size="sm" label={t('@yovoice.timeline.export')} isDisabled={!value.tracks.some(t => !t.muted && t.clips.length) || exporting} onClick={() => { stop(); setExportError(''); setPeakDb(undefined); setExportName(draft.title); setExportScope('all'); setExportOpen(true); }} />
      <Button className="timeline-extra timeline-snap-toggle" size="sm" variant={snap ? "secondary" : "ghost"} isIconOnly label={t('@yovoice.timeline.snap')} tooltip={`${t('@yovoice.timeline.snap')} · Alt`} icon={<Magnet />} aria-pressed={snap} onClick={() => setSnap(!snap)} />
      <DropdownMenu presentation="popover" placement="above" hasChevron={false} menuWidth="max-content" button={{ size: 'sm', variant: 'ghost', isIconOnly: true, label: t('@yovoice.timeline.more'), icon: <MoreHorizontal />, 'data-timeline-more': 'true' }} items={menuItems} />
      <TrackZoom value={zoom} change={zoomTo} fit={fitAll} disabled={!duration} min={minZoom} max={32} />
    </PlaybackToolbar>
    {exportOpen ? <AppDialog title={t('@yovoice.timeline.export')} busy={exporting} error={formatNotice(t, exportError)} onClose={() => setExportOpen(false)} actions={<Button label={t('@yovoice.timeline.exportConfirm')} variant="primary" isLoading={exporting} isDisabled={!exportName.trim()} onClick={async () => {
      setExporting(true); setExportError('');
      try {
        const snapshot = structuredClone(value);
        const audio = context.current ??= new AudioContext();
        if (exportScope.startsWith('track:')) { snapshot.tracks = snapshot.tracks.filter(t => t.id === exportScope.slice(6)).map(t => ({ ...t, muted: false, solo: false })); }
        if (exportScope.startsWith('role:')) { const role = exportScope.slice(5); snapshot.tracks = snapshot.tracks.map(t => ({ ...t, clips: t.clips.filter(c => history.find(g => g.id === c.generationId)?.segment?.speakerId === role) })); }
        const result = await Timeline.render(snapshot, id => load(id, audio), exportScope === 'range' ? range : undefined);
        const peak = Timeline.peak(result); setPeakDb(peak ? 20 * Math.log10(peak) : -Infinity);
        if (peak > 1 && preventClipping) for (let channel = 0; channel < result.numberOfChannels; channel++) { const samples = result.getChannelData(channel); for (let i = 0; i < samples.length; i++) samples[i] *= 0.99 / peak; }
        if (peak > 1 && !preventClipping && peakDb === undefined) { setExportError(t('@yovoice.timeline.clipping')); return; }
        if (await saveAudio(encodeWav(result), exportName)) setExportOpen(false);
      } catch (error) { setExportError((error as Error).message); } finally { setExporting(false); }
    }} />}><TextInput label={t('@yovoice.timeline.exportName')} value={exportName} onChange={setExportName} /><Selector label={t('@yovoice.timeline.exportScope')} value={exportScope} onChange={v => { setExportScope(v); setPeakDb(undefined); }} options={[{ value: 'all', label: t('@yovoice.timeline.all') }, ...(range ? [{ value: 'range', label: t('@yovoice.timeline.range') }] : []), ...value.tracks.map(t => ({ value: `track:${t.id}`, label: t.name })), ...(draft.subtitles?.speakers ?? []).map((s, i) => ({ value: `role:${s.id}`, label: s.sourceName || t('@yovoice.subtitle.speaker', { n: i + 1 }) }))]} /><label><input type="checkbox" checked={preventClipping} onChange={e => { setPreventClipping(e.target.checked); setPeakDb(undefined); }} /> {t('@yovoice.timeline.preventClipping')}</label>{peakDb !== undefined ? <small>{t('@yovoice.timeline.peak')}: {Number.isFinite(peakDb) ? peakDb.toFixed(1) : '−∞'} dBFS</small> : null}</AppDialog> : null}
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
          <VStack className="multitrack-label" gap={0} vAlign="center" aria-label={track.name}>
            <HStack gap={0}><Button size="sm" variant="ghost" isIconOnly label={t(track.muted ? '@yovoice.timeline.unmute' : '@yovoice.timeline.mute', { name: track.name })} icon={track.muted ? <VolumeX /> : <Volume2 />} aria-pressed={track.muted} onClick={() => edit({ ...value, tracks: value.tracks.map(lane => lane.id === track.id ? { ...lane, muted: !lane.muted } : lane) })} /><Button size="sm" variant="ghost" isIconOnly label={t('@yovoice.timeline.removeTrack', { name: track.name })} icon={<Trash2 />} isDisabled={track.locked || track.clips.length > 0} onClick={() => edit({ ...value, tracks: value.tracks.filter(lane => lane.id !== track.id) })} /><Popover placement="above" label={track.name} content={<VStack padding={3} gap={2}>
              <TextInput size="sm" label={t('@yovoice.timeline.trackName')} value={track.name} onChange={name => { if (name.trim()) updateTrack(track.id, { name: name.slice(0, 120) }); }} />
              <AudioLevel label={t('@yovoice.timeline.volume')} value={track.gainDb ?? 0} min={-60} max={12} unit="dB" change={gainDb => updateTrack(track.id, { gainDb })} />
              <AudioLevel label={t('@yovoice.timeline.duck')} value={track.duckDb ?? 0} min={0} max={36} unit="dB" change={duckDb => updateTrack(track.id, { duckDb })} />
              <HStack gap={1}><Button size="sm" label={t('@yovoice.timeline.solo')} icon={<Headphones />} aria-pressed={!!track.solo} onClick={() => updateTrack(track.id, { solo: !track.solo })} /><Button size="sm" label={t(track.locked ? '@yovoice.timeline.unlock' : '@yovoice.timeline.lock')} icon={track.locked ? <Lock /> : <Unlock />} aria-pressed={!!track.locked} onClick={() => updateTrack(track.id, { locked: !track.locked })} /></HStack>
            </VStack>}><Button size="sm" variant="ghost" isIconOnly icon={track.locked ? <Lock /> : track.solo ? <Headphones /> : <SlidersHorizontal />} label={t('@yovoice.timeline.trackSettings', { name: track.name })} /></Popover></HStack>
          </VStack>
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
            {track.clips.map(c => <HStack key={c.id} className="multitrack-region" gap={0} data-clip-id={c.id} data-selected={selectedIds.includes(c.id)} style={{ left: `${c.start / scale * 100}%`, width: `${c.duration / scale * 100}%`, opacity: track.muted ? 0.5 : 1 }}>
              <Button size="sm" variant="secondary" className="multitrack-clip" label={audioSources.get(Timeline.sourceKey(c))?.title ?? t('@yovoice.timeline.missing')} aria-pressed={selectedIds.includes(c.id)} icon={<>{history.find(g => g.id === c.generationId)?.segment ? <SpeakerAvatar seed={`${draft.id}:${history.find(g => g.id === c.generationId)!.segment!.speakerId}`} /> : null}{peaks[Timeline.sourceKey(c)] ? <svg className="clip-waveform" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">{peaks[Timeline.sourceKey(c)].slice(Math.floor(c.offset / buffers.current.get(Timeline.sourceKey(c))!.duration * peaks[Timeline.sourceKey(c)].length), Math.ceil((c.offset + c.duration) / buffers.current.get(Timeline.sourceKey(c))!.duration * peaks[Timeline.sourceKey(c)].length)).map((peak, i, values) => <line key={i} x1={i / values.length * 400} x2={i / values.length * 400} y1={20 - peak * 18} y2={20 + peak * 18} />)}</svg> : null}</>} onPointerDown={e => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || track.locked) return;
                const ids = selectedIds.includes(c.id) ? selectedIds : [c.id];
                if (!selectedIds.includes(c.id)) selectClip(c);
                const rect = e.currentTarget.closest('.multitrack-lane')!.getBoundingClientRect(), pps = rect.width / scale;
                beginGesture(e, (dx, dy, alt) => {
                  let delta = dx / pps;
                  const laneDelta = Math.round(dy / rect.height);
                  const moving = snap && !alt && laneDelta === 0 ? Timeline.following(value, ids) : ids;
                  const picked = value.tracks.flatMap(t => t.clips.filter(c => moving.includes(c.id)));
                  const result = snap && !alt ? Timeline.snap(value, moving, picked.flatMap(c => [c.start + delta, c.start + c.duration + delta]), 7 / pps, time) : { delta: 0, guide: undefined };
                  delta += result.delta; setGuide(result.guide);
                  preview(Timeline.moveGroup(value, ids, delta, laneDelta, snap && !alt));
                }, Math.max(c.start, Math.min(c.start + c.duration, (e.clientX - rect.left) / pps)));
              }} onClick={e => { if (suppressClick.current) { suppressClick.current = false; return; } selectClip(c, e); if (e.detail === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) { seek(c.start); setRange(undefined); } }} onKeyDown={e => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                e.preventDefault(); if (!selectedIds.includes(c.id)) selectClip(c);
                const lane = value.tracks.indexOf(track);
                const destination = value.tracks[lane + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0)];
                const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
                if (destination) edit(Timeline.moveGroup(value, selectedIds.includes(c.id) ? selectedIds : [c.id], delta * (e.shiftKey ? 0.1 : 0.01), value.tracks.indexOf(destination) - lane, snap && !e.altKey));
              }} />
              {(['start', 'end'] as const).map(edge => <Button key={edge} size="sm" variant="ghost" isIconOnly className="multitrack-trim" data-edge={edge}
                label={t(edge === 'start' ? '@yovoice.timeline.trimStart' : '@yovoice.timeline.trimEnd')} role="slider" aria-orientation="horizontal"
                aria-valuemin={edge === 'start' ? (snap ? 0 : Math.max(0, c.offset - c.start)) : c.offset + 0.01}
                aria-valuemax={edge === 'start' ? c.offset + c.duration - 0.01 : audioSources.get(Timeline.sourceKey(c))?.duration ?? c.offset + c.duration}
                aria-valuenow={Number((edge === 'start' ? c.offset : c.offset + c.duration).toFixed(2))}
                isDisabled={!!track.locked} onPointerDown={e => {
                  const sourceDuration = audioSources.get(Timeline.sourceKey(c))?.duration;
                  if (!sourceDuration || track.locked) return;
                  selectClip(c); const pps = e.currentTarget.closest('.multitrack-lane')!.getBoundingClientRect().width / scale;
                  beginGesture(e, (dx, _dy, alt) => {
                    const position = c.start + (edge === 'end' ? c.duration : 0) + dx / pps;
                    const result = snap && !alt ? Timeline.snap(value, Timeline.following(value, [c.id]), [position], 7 / pps, time) : { delta: 0, guide: undefined };
                    setGuide(result.guide); preview(Timeline.trimEdge(value, c.id, edge, Math.round((dx / pps + result.delta) * 100) / 100, sourceDuration, snap && !alt));
                  }, c.start + (edge === 'end' ? c.duration : 0));
                }}
                onKeyDown={e => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault(); selectClip(c);
                  edit(Timeline.trimEdge(value, c.id, edge, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01), audioSources.get(Timeline.sourceKey(c))?.duration ?? 0, snap && !e.altKey));
                }} />)}
            </HStack>)}
            {[...track.clips].sort((a, b) => a.start - b.start).map((c, i, clips) => {
              const end = Math.max(0, ...clips.slice(0, i).map(v => v.start + v.duration)), gap = c.start - end;
              return gap > 0.01 ? <Button key={`gap-${c.id}`} size="sm" variant="ghost" isIconOnly icon={<GripVertical />} className="timeline-gap" label={`${t('@yovoice.timeline.gap')} ${gap.toFixed(2)}s`} tooltip={`${gap.toFixed(2)}s`} isDisabled={!!track.locked} style={{ left: `${(end + gap / 2) / scale * 100}%` }} onPointerDown={e => { selectClip(c); const pps = e.currentTarget.closest('.multitrack-lane')!.getBoundingClientRect().width / scale; beginGesture(e, dx => preview(Timeline.gap(value, c.id, Math.max(0, gap + dx / pps)))); }} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); edit(Timeline.gap(value, c.id, Math.max(0, gap + (e.key === 'ArrowRight' ? 0.1 : -0.1)))); } }} /> : null;
            })}
            {guide !== undefined ? <i className="timeline-snap-guide" style={{ left: `${guide / scale * 100}%` }} /> : null}
            {range ? <i className="timeline-range" style={{ left: `${range.start / scale * 100}%`, width: `${(range.end - range.start) / scale * 100}%` }} /> : null}
            <i className="multitrack-playhead" aria-hidden="true" style={{ left: `${Math.min(time, scale) / scale * 100}%` }} />
            <HStack className="multitrack-add-audio" gap={0} style={{ left: `calc(${Math.max(0, ...track.clips.map(c => c.start + c.duration)) / scale * 100}% + var(--spacing-2))` }}>
              <DropdownMenu className="timeline-audio-menu" presentation="popover" placement="above" alignment="start" hasChevron={false} menuWidth="max-content"
                button={{ size: 'sm', variant: 'secondary', className: 'timeline-audio-button', icon: <FileAudio />, label: t('@yovoice.timeline.audio'), 'aria-label': t('@yovoice.timeline.importTo', { name: track.name }), isLoading: importing && uploadTrack.current === track.id, isDisabled: importing || track.locked }}
                items={[
                  { label: t('@yovoice.timeline.upload'), icon: Upload, onClick: () => { uploadTrack.current = track.id; input.current?.click(); } },
                  ...(projectKind(draft) === 'text' ? [{ label: t('@yovoice.timeline.fromHistory'), icon: History, onClick: () => { stop(); setHistoryQuery(''); setHistoryTrack(track.id); } }] : []),
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
