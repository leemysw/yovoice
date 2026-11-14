import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Play, Pause, ZoomIn, ZoomOut } from 'lucide-react';
import { formatTime } from '../../shared/workbench';
import { withHotkey } from '../../shared/hotkeys/hotkeys';

export function PlaybackToolbar({ time, duration, playing, disabled, loading, toggle, beforePlay, afterPlay, keys, aria, children }: {
  time: number; duration: number; playing: boolean; disabled: boolean; loading?: boolean; toggle: () => void;
  beforePlay?: ReactNode; afterPlay?: ReactNode;
  /** 播放键的按键文字与 aria-keyshortcuts，由使用方按自己注册的命令给出。 */
  keys?: string; aria?: string; children: ReactNode;
}) {
  const t = useTranslator();
  const playLabel = t(playing ? '@yovoice.player.pause' : '@yovoice.player.play');
  // 播放组和时间靠左相邻，右侧整组放工具，中间不留空档。
  return <HStack className="transport" vAlign="center" gap={3} wrap="wrap">
    <HStack className="transport-controls" gap={1} vAlign="center">
      {beforePlay}
      <Button label={playLabel} tooltip={withHotkey(playLabel, keys, undefined)} aria-keyshortcuts={aria} isIconOnly icon={playing ? <Pause /> : <Play fill="currentColor" />} size="sm" variant="primary" className="play-main" isDisabled={disabled} isLoading={loading} onClick={toggle} />
      {afterPlay}
    </HStack>
    <small className="transport-time">{formatTime(time)} <em>/ {formatTime(duration)}</em></small>
    <HStack className="transport-end" gap={3} vAlign="center" wrap="wrap">{children}</HStack>
  </HStack>;
}

// keys 是缩小、适应全部、放大三个按钮的按键文字，有对应快捷键的使用方（多轨时间线）传入。
export function TrackZoom({ value, change, disabled, min = 1, max = 8, fit, keys }: { value: number; change: (value: number) => void; disabled: boolean; min?: number; max?: number; fit?: () => void; keys?: { out: string; fit: string; in: string } }) {
  const t = useTranslator();
  const tip = (label: string, key?: string) => withHotkey(label, key, undefined);
  return <HStack className="track-zoom" gap={0} vAlign="center" role="group" aria-label={t('@yovoice.player.zoomGroup')}>
    <Button label={t('@yovoice.player.zoomOut')} tooltip={tip(t('@yovoice.player.zoomOut'), keys?.out)} isIconOnly icon={<ZoomOut />} size="sm" variant="ghost" isDisabled={disabled || value <= min} onClick={() => change(Math.max(min, value / 2))} />
    <Button label={`${Number((value * 100).toFixed(2))}%`} aria-label={t('@yovoice.player.zoomFit')} tooltip={tip(t('@yovoice.player.zoomFit'), keys?.fit)} size="sm" variant="ghost" isDisabled={disabled} onClick={() => fit ? fit() : change(1)} />
    <Button label={t('@yovoice.player.zoomIn')} tooltip={tip(t('@yovoice.player.zoomIn'), keys?.in)} isIconOnly icon={<ZoomIn />} size="sm" variant="ghost" isDisabled={disabled || value >= max} onClick={() => change(Math.min(max, value * 2))} />
  </HStack>;
}
