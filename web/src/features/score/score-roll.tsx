import { useEffect, useRef } from 'react';
import type { Score, ScoreRole } from '../../shared/workbench';
import { beatsPerBar, scoreBars, scoreDuration, scoreSeconds } from './score-draft';

// 声部按角色着色：同一首曲子里铺底、旋律、节奏一眼可分。
export const roleHue: Record<ScoreRole, number> = { melody: 330, piano: 200, strings: 275, bass: 25, drums: 5, pad: 170, arp: 48, other: 220 };

const header = 28, lane = 44;

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
      // 画布不能解析 CSS 变量，颜色取元素计算后的文字色与背景色。
      const style = getComputedStyle(element), ink = style.color, surface = style.backgroundColor;
      context.clearRect(0, 0, width, height);
      const total = Math.max(1, scoreDuration(score)), x = (seconds: number) => seconds / total * width;
      // 段落条与小节线。
      context.font = `12px ${style.fontFamily}`; context.textBaseline = 'middle';
      (score.sections ?? []).forEach((section, i) => {
        const start = x(scoreSeconds(score, section.start)), end = x(scoreSeconds(score, section.end + 1));
        context.fillStyle = `hsl(${(210 + i * 47) % 360} 60% 50% / 0.16)`; context.fillRect(start, 2, end - start - 2, header - 6);
        context.fillStyle = ink; context.fillText(section.tempo ? `${section.name} · ${section.tempo}` : section.name, start + 6, header / 2 - 1, Math.max(0, end - start - 10));
      });
      context.strokeStyle = ink; context.lineWidth = 1; context.globalAlpha = .08;
      for (let bar = 1; bar <= scoreBars(score) + 1; bar++) {
        const at = Math.round(x(scoreSeconds(score, bar))) + .5;
        context.beginPath(); context.moveTo(at, header); context.lineTo(at, height); context.stroke();
      }
      context.globalAlpha = 1;
      const per = beatsPerBar(score);
      score.tracks.forEach((track, i) => {
        const top = header + i * lane, hue = roleHue[track.role ?? 'other'];
        if (track.id === selected) { context.fillStyle = `hsl(${hue} 70% 50% / 0.1)`; context.fillRect(0, top, width, lane); }
        const pitches = track.notes.map(n => n.pitch), low = Math.min(...pitches), high = Math.max(...pitches), span = Math.max(12, high - low);
        context.save();
        context.shadowColor = `hsl(${hue} 90% 60% / 0.7)`; context.shadowBlur = 6;
        for (const n of track.notes) {
          const start = scoreSeconds(score, n.bar, n.beat);
          const position = (n.bar - 1) * per + n.beat - 1 + n.length, endBar = Math.floor(position / per) + 1;
          const end = scoreSeconds(score, endBar, position - (endBar - 1) * per + 1);
          const y = top + 6 + (1 - (n.pitch - low) / span) * (lane - 16);
          context.fillStyle = `hsl(${hue} 85% ${45 + n.velocity / 127 * 25}% / ${track.mute ? 0.2 : 0.35 + n.velocity / 127 * 0.65})`;
          context.fillRect(x(start), y, Math.max(1.5, x(end) - x(start) - 1), 4);
        }
        context.restore();
        // 声部名压在音块上方，衬底保证可读。
        const label = context.measureText(track.name).width;
        context.fillStyle = surface; context.globalAlpha = .85; context.fillRect(2, top + lane - 17, label + 8, 16); context.globalAlpha = 1;
        context.fillStyle = ink; context.globalAlpha = .7; context.fillText(track.name, 6, top + lane - 9); context.globalAlpha = 1;
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
