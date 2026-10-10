import { useEffect, useRef } from 'react';
import type { Score } from '../../shared/workbench';
import { beatsPerBar, scoreBars, scoreDuration, scoreSeconds } from './score-draft';

const header = 30, lane = 44;

// 音块视图：横向是时间（按段落变速换算），每个声部一条轨，块的长短、高低、亮度对应时值、音高和力度。
export function ScoreRoll({ score, selected, select, label }: { score: Score; selected?: string; select: (id: string) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1, width = element.clientWidth, height = header + lane * Math.max(1, score.tracks.length);
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio); element.style.height = `${height}px`;
      const context = element.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // 画布不能解析 CSS 变量，颜色取元素计算后的文字色、背景色和强调色（outline-color）。
      const style = getComputedStyle(element), ink = style.color, surface = style.backgroundColor, accent = style.outlineColor;
      const mono = style.getPropertyValue('--score-roll-mono').trim() || 'monospace';
      context.clearRect(0, 0, width, height);
      const total = Math.max(1, scoreDuration(score)), x = (seconds: number) => seconds / total * width;
      // 段落：隔段浅色衬底，等宽小字标名称和小节范围。
      context.textBaseline = 'middle';
      (score.sections ?? []).forEach((section, i) => {
        const start = x(scoreSeconds(score, section.start)), end = x(scoreSeconds(score, section.end + 1));
        if (i % 2 === 0) { context.fillStyle = ink; context.globalAlpha = .045; context.fillRect(start, 0, end - start, height); }
        context.globalAlpha = .9; context.fillStyle = ink; context.font = `500 11px ${mono}`;
        const name = section.name.toUpperCase();
        context.fillText(name, start + 8, header / 2, Math.max(0, end - start - 16));
        const used = context.measureText(name).width;
        context.globalAlpha = .45; context.font = `11px ${mono}`;
        const detail = `${String(section.start).padStart(2, '0')}–${String(section.end).padStart(2, '0')}${section.tempo ? ` · ${section.tempo}` : ''}`;
        if (start + 8 + used + 8 + context.measureText(detail).width < end - 8) context.fillText(detail, start + 8 + used + 8, header / 2);
        context.globalAlpha = 1;
      });
      context.strokeStyle = ink; context.lineWidth = 1; context.globalAlpha = .07;
      for (let bar = 1; bar <= scoreBars(score) + 1; bar++) {
        const at = Math.round(x(scoreSeconds(score, bar))) + .5;
        context.beginPath(); context.moveTo(at, header); context.lineTo(at, height); context.stroke();
      }
      context.globalAlpha = .14; context.beginPath(); context.moveTo(0, header - .5); context.lineTo(width, header - .5); context.stroke();
      context.globalAlpha = 1;
      const per = beatsPerBar(score);
      score.tracks.forEach((track, i) => {
        const top = header + i * lane, color = track.role === 'melody' ? accent : ink;
        if (track.id === selected) { context.fillStyle = ink; context.globalAlpha = .08; context.fillRect(0, top, width, lane); context.globalAlpha = 1; }
        const pitches = track.notes.map(n => n.pitch), low = Math.min(...pitches), high = Math.max(...pitches), span = Math.max(12, high - low);
        // 同色系音块，力度决定深浅；静音声部只留轮廓感。
        context.fillStyle = color;
        for (const n of track.notes) {
          const start = scoreSeconds(score, n.bar, n.beat);
          const position = (n.bar - 1) * per + n.beat - 1 + n.length, endBar = Math.floor(position / per) + 1;
          const end = scoreSeconds(score, endBar, position - (endBar - 1) * per + 1);
          const y = top + 6 + (1 - (n.pitch - low) / span) * (lane - 18);
          context.globalAlpha = track.mute ? .12 : .3 + n.velocity / 127 * .6;
          context.fillRect(x(start), y, Math.max(1.5, x(end) - x(start) - 1), 3);
        }
        context.globalAlpha = 1;
        // 声部名压在音块下方，衬底保证可读。
        context.font = `11px ${mono}`;
        const label = context.measureText(track.name).width;
        context.fillStyle = surface; context.globalAlpha = .8; context.fillRect(4, top + lane - 17, label + 8, 15);
        context.fillStyle = ink; context.globalAlpha = .55; context.fillText(track.name, 8, top + lane - 9.5); context.globalAlpha = 1;
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [score, selected]);
  return <canvas ref={canvas} className="score-roll" role="img" aria-label={label}
    onClick={event => { const index = Math.floor((event.nativeEvent.offsetY - header) / lane); const track = score.tracks[index]; if (track) select(track.id); }} />;
}
