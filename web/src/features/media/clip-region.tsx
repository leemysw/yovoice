import type { RefObject } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { GripVertical } from 'lucide-react';
import { SpeakerAvatar } from '../create/subtitles';
import type { AudioClip, AudioLane, AudioTimeline, Draft, Generation } from '../../shared/workbench';
import { Timeline, type AudioSource } from './timeline';
import type { Waveform } from './waveform';
import type { TimelineGestures } from './use-timeline-gestures';

// 片段与空隙手柄共用的时间线上下文：每个片段只额外收自己的 clip 与所在音轨。
export type ClipSharedProps = {
  value: AudioTimeline; history: Generation[]; draft: Draft; audioSources: Map<string, AudioSource>;
  scale: number; time: number; snap: boolean; selectedIds: string[];
  peaks: Record<string, number[]>; waves: RefObject<Map<string, Waveform>>; unavailable: Record<string, boolean>;
  selectClip: (clip: AudioClip, event?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  gestures: TimelineGestures; seek: (time: number) => void; setRange: (range: { start: number; end: number } | undefined) => void; edit: (next: AudioTimeline) => void;
};

// 片段波形：按片段在源音频里的偏移与时长截取峰值，拉伸到片段宽度。
function ClipWaveform({ clip: c, peaks, wave }: { clip: AudioClip; peaks: number[]; wave: Waveform }) {
  return <svg className="clip-waveform" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">{peaks.slice(Math.floor(c.offset / wave.duration * peaks.length), Math.ceil((c.offset + c.duration) / wave.duration * peaks.length)).map((peak, i, values) => <line key={i} x1={i / values.length * 400} x2={i / values.length * 400} y1={20 - peak * 18} y2={20 + peak * 18} />)}</svg>;
}

// 音轨上的一个片段：主体按下拖动移动（可跨轨、可吸附），两端手柄裁剪，方向键微调。
export function ClipRegion({ clip: c, track, value, history, draft, audioSources, scale, time, snap, selectedIds, peaks, waves, unavailable, selectClip, gestures, seek, setRange, edit }: ClipSharedProps & { clip: AudioClip; track: AudioLane }) {
  const t = useTranslator();
  const { beginGesture, preview, setGuide, suppressClick } = gestures;
  const key = Timeline.sourceKey(c);
  const source = audioSources.get(key);
  const segment = history.find(g => g.id === c.generationId)?.segment;
  return <HStack className="multitrack-region" gap={0} data-clip-id={c.id} data-selected={selectedIds.includes(c.id)} style={{ left: `${c.start / scale * 100}%`, width: `${c.duration / scale * 100}%`, opacity: track.muted ? 0.5 : 1 }}>
    <Button size="sm" variant="secondary" className="multitrack-clip" data-unavailable={unavailable[key] || undefined} label={source?.title ?? t('@yovoice.timeline.missing')} aria-pressed={selectedIds.includes(c.id)}
      icon={<>{segment ? <SpeakerAvatar seed={`${draft.id}:${segment.speakerId}`} /> : null}{peaks[key] ? <ClipWaveform clip={c} peaks={peaks[key]} wave={waves.current.get(key)!} /> : null}</>}
      onPointerDown={e => {
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
      }}
      onClick={e => { if (suppressClick.current) { suppressClick.current = false; return; } selectClip(c, e); if (e.detail === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) { seek(c.start); setRange(undefined); } }}
      onKeyDown={e => {
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
      aria-valuemax={edge === 'start' ? c.offset + c.duration - 0.01 : source?.duration ?? c.offset + c.duration}
      aria-valuenow={Number((edge === 'start' ? c.offset : c.offset + c.duration).toFixed(2))}
      isDisabled={!!track.locked} onPointerDown={e => {
        const sourceDuration = source?.duration;
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
        edit(Timeline.trimEdge(value, c.id, edge, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01), source?.duration ?? 0, snap && !e.altKey));
      }} />)}
  </HStack>;
}

// 片段前的空隙手柄：拖动或方向键调整与前一片段的间距；end 是前一片段的结束时间，gap 是空隙长度。
export function GapHandle({ clip: c, gap, end, track, value, scale, selectClip, gestures, edit }: ClipSharedProps & { clip: AudioClip; gap: number; end: number; track: AudioLane }) {
  const t = useTranslator();
  const { beginGesture, preview } = gestures;
  return <Button size="sm" variant="ghost" isIconOnly icon={<GripVertical />} className="timeline-gap" label={`${t('@yovoice.timeline.gap')} ${gap.toFixed(2)}s`} tooltip={`${gap.toFixed(2)}s`} isDisabled={!!track.locked} style={{ left: `${(end + gap / 2) / scale * 100}%` }} onPointerDown={e => { selectClip(c); const pps = e.currentTarget.closest('.multitrack-lane')!.getBoundingClientRect().width / scale; beginGesture(e, dx => preview(Timeline.gap(value, c.id, Math.max(0, gap + dx / pps)))); }} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); edit(Timeline.gap(value, c.id, Math.max(0, gap + (e.key === 'ArrowRight' ? 0.1 : -0.1)))); } }} />;
}
