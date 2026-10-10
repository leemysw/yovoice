import { useEffect, useRef } from 'react';
import type { Score } from '../../shared/workbench';
import { beatsPerBar, scoreBars } from './score-draft';

// 作品封面用的乐谱缩略图：胶片底色上按声部画出音块，主旋律用强调色。
export function ScoreThumb({ score, size = 96 }: { score?: Score; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, context = element?.getContext('2d');
    if (!element || !context) return;
    const style = getComputedStyle(element), { width, height } = element;
    context.fillStyle = style.backgroundColor; context.fillRect(0, 0, width, height);
    const tracks = score?.tracks.filter(track => track.notes.length) ?? [];
    if (!score || !tracks.length) return;
    const per = beatsPerBar(score), total = Math.max(1, scoreBars(score) * per), pad = width * .1;
    const lane = (height - pad * 2) / tracks.length;
    tracks.forEach((track, i) => {
      const pitches = track.notes.map(n => n.pitch), low = Math.min(...pitches), span = Math.max(12, Math.max(...pitches) - low);
      context.fillStyle = track.role === 'melody' ? style.outlineColor : style.color;
      for (const n of track.notes) {
        const at = (n.bar - 1) * per + n.beat - 1;
        context.globalAlpha = .35 + n.velocity / 127 * .55;
        context.fillRect(pad + at / total * (width - pad * 2), pad + i * lane + (1 - (n.pitch - low) / span) * (lane - 2), Math.max(1, n.length / total * (width - pad * 2)), Math.max(1, width / 96));
      }
    });
    context.globalAlpha = 1;
  }, [score]);
  return <canvas ref={canvas} className="score-thumb" width={size * 2} height={size * 2} aria-hidden="true" />;
}
