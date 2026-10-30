import type { RefObject } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import type { LyricLine } from './lyric-timing';

// 滚动歌词：整首歌词逐行排列，当前句逐字点亮，跟随动效由 useLyricFollow 通过 box 逐帧驱动。
// 校准时标出待标记的目标行（sync 是已标记的行开始时间），逐字编辑时标出正在编辑的一句。
// 点某一句跳到它开头并播放；校准时不响应，编辑时交给编辑器填入的 lineClick 处理。
export function ScrollLyrics({ box, lines, current, sync, editing, editLine, lineClick, audio, seek, play }: {
  box: RefObject<HTMLElement | null>; lines: LyricLine[]; current: number; sync: number[] | null; editing: boolean; editLine: number;
  lineClick: RefObject<((index: number) => void) | null>; audio: RefObject<HTMLAudioElement | null>; seek: (value: number) => void; play: () => void;
}) {
  const t = useTranslator();
  const lineState = (index: number) => index === current ? 'current' : index < current ? 'past' : 'next';
  // 滚动歌词只把当前句拆成逐字，其余行是整句文字。
  const lineText = (line: LyricLine, index: number) => line.instrumental ? '• • •'
    : !sync && index === current && line.words ? line.words.map((word, k) => <Text type="inherit" color="inherit" key={k} className="now-playing-word" data-word-start={String(word.start)} data-word-end={String(word.end)}>{word.text}</Text>) : line.text;
  return <VStack ref={box} className="now-playing-lyrics" gap={0} role="list" aria-label={t('@yovoice.music.lyrics')}>
    {lines.map((line, index) => <p key={`${sync ? 'sync' : 'play'}-${index}`} role="listitem" data-index={index} className="now-playing-line" data-state={lineState(index)}
      data-target={sync && index === sync.length || undefined} data-instrumental={line.instrumental || undefined}
      data-editing={editing && index === editLine || undefined}
      title={sync || line.instrumental ? undefined : t(editing ? '@yovoice.music.editThisLine' : '@yovoice.music.seekLyric')} onClick={() => {
        if (sync || line.instrumental) return;
        if (editing) { lineClick.current?.(index); return; }
        seek(line.start); if (audio.current?.paused) void play();
      }}>
      {lineText(line, index)}
    </p>)}
  </VStack>;
}
