import { useMemo, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack } from '@astryxdesign/core/Layout';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { ArrowLeftRight, AudioLines, Check, ChevronDown, Download, Eraser, ListMusic, Maximize, Minimize, SlidersHorizontal, Timer } from 'lucide-react';
import { formatActivity, formatDateTime } from '../../shared/i18n/format';
import type { Activity, Generation } from '../../shared/workbench';
import { readLocal, writeLocal } from '../../shared/lib/local-store';
import type { LyricTiming } from './use-lyric-timing';

// 歌词样式：scroll 是整首滚动、当前句逐字点亮；stage 是一句一屏，字随演唱逐个跃出并发光，适合录屏。选择记在本机。
export type LyricStyle = 'scroll' | 'stage';
const lyricStyleKey = 'yovoice-lyric-style';
const savedLyricStyle = (): LyricStyle => readLocal(lyricStyleKey) === 'stage' ? 'stage' : 'scroll';
export function useLyricStyle() {
  const [lyricStyle, setLyricStyle] = useState(savedLyricStyle);
  const chooseStyle = (value: LyricStyle) => { setLyricStyle(value); writeLocal(lyricStyleKey, value); };
  return [lyricStyle, chooseStyle] as const;
}

// 播放页顶部工具栏：关闭、版本切换与 A/B 来回切、对齐进度、歌词工具（对齐、逐字编辑、逐行校准、清除、导出 LRC）、歌词样式和全屏。
// 随控件一起在静置时隐藏。timing 是 useLyricTiming 的歌词时间状态，歌词工具直接操作它。
export function NowPlayingToolbar({ item, versions, previous, switchTo, url, aligner, activity, timing, lyricStyle, chooseStyle, fullscreen, toggleFullscreen, leave }: {
  item: Generation; versions: Generation[]; previous: Generation | null; switchTo: (next: Generation) => void; url: string; aligner: boolean; activity?: Activity | null;
  timing: LyricTiming; lyricStyle: LyricStyle; chooseStyle: (value: LyricStyle) => void; fullscreen: boolean; toggleFullscreen: () => void; leave: () => void;
}) {
  const t = useTranslator();
  const locale = useLocale();
  // 版本号按生成先后从 1 开始，与版本记录一致。
  const ordered = useMemo(() => [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [versions]);
  const versionNumber = (value: Generation) => ordered.findIndex(entry => entry.id === value.id) + 1;
  const { rows, sync, edit, times, auto, fromModel, timeline, running, aligning, alignNow, startEdit, startSync, save, exportLrc } = timing;
  return <HStack className="now-playing-bar now-playing-chrome" gap={2} hAlign="between" vAlign="center">
    <Button className="now-playing-glass now-playing-round" label={t('@yovoice.music.closeNowPlaying')} isIconOnly variant="ghost" icon={<ChevronDown />} onClick={leave} />
    {ordered.length > 1 ? <HStack className="now-playing-versions" gap={1} vAlign="center">
      <DropdownMenu presentation="popover" alignment="center" menuWidth="max-content"
        button={{ className: 'now-playing-glass', size: 'sm', variant: 'ghost', label: t('@yovoice.app.historyVersion', { n: versionNumber(item) }), tooltip: t('@yovoice.music.compareVersions') }}
        items={[...ordered].reverse().map(entry => ({ id: entry.id, label: t('@yovoice.app.historyVersion', { n: versionNumber(entry) }), description: formatDateTime(entry.createdAt, locale, 'brief'),
          endContent: entry.id === item.id ? <Check size={14} /> : undefined, onClick: () => switchTo(entry) }))} />
      {previous && previous.id !== item.id ? <Button className="now-playing-glass" size="sm" variant="ghost" icon={<ArrowLeftRight />} label={t('@yovoice.music.switchBack', { n: versionNumber(previous) })} tooltip={t('@yovoice.music.switchBackHint')} onClick={() => switchTo(previous)} /> : null}
    </HStack> : null}
    <HStack gap={2} vAlign="center">
      {aligning ? <small className="now-playing-status" role="status">{formatActivity(t, activity)}</small> : null}
      {rows.length && !sync && !edit ? <DropdownMenu presentation="popover" alignment="end" menuWidth="max-content" hasChevron={false}
        button={{ className: 'now-playing-glass now-playing-round', variant: 'ghost', isIconOnly: true, icon: <ListMusic />, label: t('@yovoice.music.lyricTools'), tooltip: t('@yovoice.music.lyricTools'), isLoading: aligning }}
        items={[
          { type: 'section', id: 'timing', title: t(fromModel ? '@yovoice.music.lyricsAligned' : times ? '@yovoice.music.lyricsSynced' : auto ? '@yovoice.music.lyricsAnalyzed' : '@yovoice.music.lyricsEstimated'), items: [
            { id: 'align', icon: <AudioLines />, label: t(aligning ? '@yovoice.music.aligningLyrics' : '@yovoice.music.alignLyrics'), description: t(aligner ? '@yovoice.music.alignLyricsHint' : '@yovoice.music.alignLyricsDownload'), isDisabled: !url || running, onClick: alignNow },
            { id: 'words', icon: <SlidersHorizontal />, label: t('@yovoice.music.editWords'), description: t('@yovoice.music.editWordsHint'), isDisabled: !url || aligning || !timeline.length, onClick: startEdit },
            { id: 'sync', icon: <Timer />, label: t(times || fromModel ? '@yovoice.music.resyncLyrics' : '@yovoice.music.syncLyrics'), description: t('@yovoice.music.syncLyricsHint'), isDisabled: !url || aligning, onClick: startSync },
            ...(times || fromModel ? [{ id: 'reset', icon: <Eraser />, label: t('@yovoice.music.syncReset'), isDisabled: aligning, onClick: () => save(undefined) }] : []),
          ] },
          { type: 'divider' },
          { id: 'lrc', icon: <Download />, label: t('@yovoice.music.exportLrc'), isDisabled: !timeline.length, onClick: () => exportLrc() },
          { id: 'word-lrc', icon: <Download />, label: t('@yovoice.music.exportWordLrc'), description: t('@yovoice.music.exportWordLrcHint'), isDisabled: !timeline.length, onClick: () => exportLrc(true) },
        ]} /> : null}
      {rows.length ? <DropdownMenu presentation="popover" alignment="end" menuWidth="max-content"
        button={{ className: 'now-playing-glass now-playing-style', variant: 'ghost', size: 'sm', label: t(lyricStyle === 'stage' ? '@yovoice.music.lyricStyleStage' : '@yovoice.music.lyricStyleScroll'), tooltip: t('@yovoice.music.lyricStyle') }}
        items={(['scroll', 'stage'] as const).map(value => ({ id: value, label: t(value === 'stage' ? '@yovoice.music.lyricStyleStage' : '@yovoice.music.lyricStyleScroll'),
          description: t(value === 'stage' ? '@yovoice.music.lyricStyleStageHint' : '@yovoice.music.lyricStyleScrollHint'), endContent: lyricStyle === value ? <Check size={14} /> : undefined, onClick: () => chooseStyle(value) }))} /> : null}
      {document.fullscreenEnabled ? <Button className="now-playing-glass now-playing-round" label={t(fullscreen ? '@yovoice.music.exitFullscreen' : '@yovoice.music.fullscreen')} isIconOnly variant="ghost" icon={fullscreen ? <Minimize /> : <Maximize />} onClick={toggleFullscreen} /> : null}
    </HStack>
  </HStack>;
}
