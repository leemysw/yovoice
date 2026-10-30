import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Popover } from '@astryxdesign/core/Popover';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Headphones, Lock, SlidersHorizontal, Trash2, Unlock, Volume2, VolumeX } from 'lucide-react';
import type { AudioLane, AudioTimeline } from '../../shared/workbench';
import { AudioLevel } from './audio-level';

// 轨头显示音轨名，只留静音与设置两个常用按钮；删除音轨放进设置面板底部，避免挨着静音误点。
export function TrackHeader({ track, value, edit }: { track: AudioLane; value: AudioTimeline; edit: (next: AudioTimeline) => void }) {
  const t = useTranslator();
  const updateTrack = (id: string, patch: Partial<AudioLane>) => edit({ ...value, tracks: value.tracks.map(t => t.id === id ? { ...t, ...patch } : t) });
  return <HStack className="multitrack-label" gap={0} vAlign="center" aria-label={track.name}>
    <small className="multitrack-name grow" title={track.name}>{track.name}</small>
    <Button size="sm" variant="ghost" isIconOnly label={t(track.muted ? '@yovoice.timeline.unmute' : '@yovoice.timeline.mute', { name: track.name })} icon={track.muted ? <VolumeX /> : <Volume2 />} aria-pressed={track.muted} onClick={() => edit({ ...value, tracks: value.tracks.map(lane => lane.id === track.id ? { ...lane, muted: !lane.muted } : lane) })} />
    <Popover placement="above" label={track.name} content={<VStack padding={3} gap={2}>
      <TextInput size="sm" label={t('@yovoice.timeline.trackName')} value={track.name} onChange={name => { if (name.trim()) updateTrack(track.id, { name: name.slice(0, 120) }); }} />
      <AudioLevel label={t('@yovoice.timeline.volume')} value={track.gainDb ?? 0} min={-60} max={12} unit="dB" change={gainDb => updateTrack(track.id, { gainDb })} />
      <AudioLevel label={t('@yovoice.timeline.duck')} value={track.duckDb ?? 0} min={0} max={36} unit="dB" change={duckDb => updateTrack(track.id, { duckDb })} />
      <HStack gap={1}><Button size="sm" label={t('@yovoice.timeline.solo')} icon={<Headphones />} aria-pressed={!!track.solo} onClick={() => updateTrack(track.id, { solo: !track.solo })} /><Button size="sm" label={t(track.locked ? '@yovoice.timeline.unlock' : '@yovoice.timeline.lock')} icon={track.locked ? <Lock /> : <Unlock />} aria-pressed={!!track.locked} onClick={() => updateTrack(track.id, { locked: !track.locked })} /></HStack>
      <Button size="sm" variant="destructive" icon={<Trash2 />} label={t('@yovoice.timeline.removeTrack', { name: track.name })} isDisabled={track.locked || track.clips.length > 0} onClick={() => edit({ ...value, tracks: value.tracks.filter(lane => lane.id !== track.id) })} />
    </VStack>}><Button size="sm" variant="ghost" isIconOnly icon={track.locked ? <Lock /> : track.solo ? <Headphones /> : <SlidersHorizontal />} label={t('@yovoice.timeline.trackSettings', { name: track.name })} /></Popover>
  </HStack>;
}
