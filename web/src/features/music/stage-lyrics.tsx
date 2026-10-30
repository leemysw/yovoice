import { useMemo, type CSSProperties } from 'react';
import { StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import type { LyricLine } from './lyric-timing';
import { backdropScene, phraseLayout } from './kinetic-lyrics';
import { SongCover } from './song-cover';

// 浮光样式的背景：小封面铺底，几何图形与光点按作品 id 派生、各自漂浮。
export function StageBackdrop({ seed, playing }: { seed: string; playing: boolean }) {
  const scene = useMemo(() => backdropScene(seed), [seed]);
  return <StackItem as="span" className="now-playing-backdrop" aria-hidden>
    <StackItem as="span" className="now-playing-backdrop-cover"><SongCover seed={seed} animated={playing} size={96} /></StackItem>
    {scene.shapes.map((shape, index) => <StackItem as="span" key={index} className="now-playing-shape" data-shape={shape.type} data-filled={shape.filled || undefined}
      style={{ '--shape-x': `${shape.x}%`, '--shape-y': `${shape.y}%`, '--shape-size': shape.size, '--shape-dir': shape.reverse ? -1 : 1, '--shape-rotate': `${shape.rotate}deg`, '--shape-opacity': shape.opacity, '--shape-band': shape.band,
        animationDuration: `${shape.duration}s`, animationDelay: `${shape.delay}s` } as CSSProperties}><StackItem as="span" className="now-playing-shape-face" /></StackItem>)}
    {scene.motes.map((mote, index) => <StackItem as="span" key={`mote-${index}`} className="now-playing-mote"
      style={{ '--mote-x': `${mote.x}%`, '--mote-y': `${mote.y}%`, '--mote-size': mote.size, '--mote-peak': mote.peak, animationDuration: `${mote.duration}s`, animationDelay: `${mote.delay}s` } as CSSProperties} />)}
  </StackItem>;
}

// 浮光样式的歌词：一句一屏，只显示当前句和正在飘走的上一句，下一句以小字预告；字的动效由 useKineticLyrics 逐帧驱动。
export function StageLyrics({ lines, current }: { lines: LyricLine[]; current: number }) {
  const t = useTranslator();
  const phrase = (index: number) => {
    const line = lines[index], words = line.words ?? [{ text: line.text, start: line.start, end: line.end }];
    const layout = phraseLayout({ ...line, words }, index);
    return <p key={`line-${index}`} className="now-playing-phrase" data-slot={index < current ? 'past' : 'current'} data-align={layout.align} data-instrumental={line.instrumental || undefined} aria-hidden={index !== current || undefined}
      style={{ '--phrase-fit': layout.fit } as CSSProperties}>
      {line.instrumental ? <Text type="inherit" color="inherit" className="now-playing-rest">• • •</Text> : words.map((word, k) => {
        const glyph = layout.glyphs[k];
        return <Text type="inherit" color="inherit" key={k} className="now-playing-glyph" data-hero={glyph.hero || undefined} data-index={k} data-text={word.text} data-word-start={String(word.start)} data-word-end={String(word.end)}
          data-x={glyph.x} data-y={glyph.y} data-rotate={glyph.rotate} data-scale={glyph.scale} data-turn={glyph.passedRotate} style={{ '--glyph-pad': `${glyph.pad.toFixed(3)}em` } as CSSProperties}>{word.text}</Text>;
      })}
    </p>;
  };
  const upcoming = lines[current + 1];
  return <VStack className="now-playing-kinetic" gap={0} role="group" aria-label={t('@yovoice.music.lyrics')}>
    {[current - 1, current].filter(index => index >= 0 && index < lines.length).map(phrase)}
    {upcoming ? <p key={`next-${current + 1}`} className="now-playing-phrase now-playing-upcoming" data-slot="next" aria-hidden>{upcoming.instrumental ? '• • •' : upcoming.text}</p> : null}
  </VStack>;
}
