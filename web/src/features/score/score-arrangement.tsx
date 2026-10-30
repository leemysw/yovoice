import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '../../shared/selector';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Check, Circle, Drum, Piano, Volume2, VolumeX } from 'lucide-react';
import { useTranslator } from '@astryxdesign/core/i18n';
import { formatTime, type Draft, type Score, type ScoreRole, type ScoreTrack } from '../../shared/workbench';
import { beatsPerBar, noteCount, scoreBars, scoreDuration, scoreRoles, scoreSeconds, targetLevel } from './score-draft';
import { gmPrograms } from './score-instruments';
import { TrackZoom } from '../media/playback-toolbar';
import { overflowTitle } from '../../shared/ui/overflow-title';

// 一个声部的音块：横向是时间（按段落变速换算），纵向是该声部自己的音域，深浅对应力度。
function ScoreLane({ score, track, zoom }: { score: Score; track: ScoreTrack; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1, width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      const context = element.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // 画布不能解析 CSS 变量：音块用元素的文字色（按角色取色），网格用边框色。
      const style = getComputedStyle(element), color = style.color, grid = style.borderTopColor;
      context.clearRect(0, 0, width, height);
      const total = Math.max(1, scoreDuration(score)), x = (seconds: number) => seconds / total * width;
      (score.sections ?? []).forEach((section, i) => {
        if (i % 2) return;
        const start = x(scoreSeconds(score, section.start)), end = x(scoreSeconds(score, section.end + 1));
        context.fillStyle = grid; context.globalAlpha = .35; context.fillRect(start, 0, end - start, height);
      });
      context.globalAlpha = .6; context.strokeStyle = grid; context.lineWidth = 1;
      for (let bar = 2; bar <= scoreBars(score); bar++) {
        const at = Math.round(x(scoreSeconds(score, bar))) + .5;
        context.beginPath(); context.moveTo(at, 0); context.lineTo(at, height); context.stroke();
      }
      const per = beatsPerBar(score);
      const pitches = track.notes.map(n => n.pitch), low = Math.min(...pitches), high = Math.max(...pitches), span = Math.max(12, high - low);
      const pad = Math.max(4, height * .14), size = Math.max(2, Math.min(4, height / 16));
      context.fillStyle = color;
      for (const n of track.notes) {
        const start = scoreSeconds(score, n.bar, n.beat);
        const position = (n.bar - 1) * per + n.beat - 1 + n.length, endBar = Math.floor(position / per) + 1;
        const end = scoreSeconds(score, endBar, position - (endBar - 1) * per + 1);
        const y = pad + (1 - (n.pitch - low) / span) * (height - pad * 2 - size);
        context.globalAlpha = .35 + n.velocity / 127 * .65;
        context.beginPath(); context.roundRect(x(start), y, Math.max(2, x(end) - x(start) - 1), size, size / 2); context.fill();
      }
      context.globalAlpha = 1;
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [score, track, zoom]);
  // 画布绝对定位在外框里，行高由轨头决定，避免画布自身尺寸反过来撑高这一行。
  return <HStack className="score-lane" gap={0}><canvas ref={canvas} aria-hidden="true" /></HStack>;
}

// 编曲视图：参照 GarageBand、Logic 的轨道区，上方是段落标尺，每个声部一行——左边窄轨头（色点切换角色，名称、电平、发声一行，音色在下一行），
// 右边是对齐时间的音块。轨道区可以像底部播放器一样缩放、横向滚动，播放时显示指针并跟随，点标尺跳到对应位置。
// 只读时（如由旋律谱换算的轨道）轨头只显示名称，改动回到谱面本身。
export function ScoreArrangement({ score, selected, select, label, updateTrack, playhead, seek, readOnly }: {
  score: Score; selected?: string; select: (id: string) => void; label: string; updateTrack: (id: string, patch: Partial<ScoreTrack>) => void;
  playhead?: { time: number; playing: boolean }; seek: (time: number) => void; readOnly?: boolean;
}) {
  const t = useTranslator();
  const total = Math.max(1, scoreDuration(score));
  const bars = scoreBars(score);
  const roleLabel = (role: ScoreRole) => t(`@yovoice.score.role.${role}`);
  const sections = score.sections?.length ? score.sections : [{ name: '', start: 1, end: scoreBars(score) }];
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLElement>(null);
  // 自然小节宽度：默认视图下保证每个小节具有舒展的横向尺度（每小节约 54px，或每秒约 20px），超出视口时自然可水平滚动浏览；曲目较短时保底填满可视区域。
  const naturalLaneWidth = Math.round(Math.max(bars * 54, total * 20));
  const laneWidth = Math.round(naturalLaneWidth * zoom);
  const laneExpr = `max(calc(100% - var(--score-head)), ${laneWidth}px)`;
  const progress = playhead ? Math.min(1, playhead.time / total) : 0;
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollerMetrics, setScrollerMetrics] = useState({ scrollWidth: 0, clientWidth: 0, headWidth: 0 });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => {
      const head = element.querySelector<HTMLElement>('.score-track-head');
      setScrollLeft(element.scrollLeft);
      setScrollerMetrics({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        headWidth: head?.offsetWidth ?? 0,
      });
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [laneWidth]);
  // 播放时指针离开可见区域就翻页，让指针回到轨道区左侧。
  useEffect(() => {
    const element = scroller.current, head = element?.querySelector<HTMLElement>('.score-track-head');
    if (!element || !head || !playhead?.playing) return;
    const lane = element.scrollWidth - head.offsetWidth, x = progress * lane;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - head.offsetWidth) element.scrollLeft = x;
  }, [progress, playhead?.playing]);
  // 鼠标滚轮直接横向滚动时间轴；Ctrl/Cmd + 滚轮调节时间轴缩放；下拉浮层和弹出菜单内部保留其自身垂直滚动。
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      // 位于下拉弹窗、菜单、列表框等弹出浮层内部时，保留其自身滚动，绝不拦截并误触发轨道横滚。
      if (target?.closest('[popover], [role="listbox"], [role="menu"], .astryx-selector-popup, .astryx-popover, .astryx-dropdown-menu, .astryx-field')) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(current => {
          const factor = e.deltaY < 0 ? 1.25 : 0.8;
          return Number(Math.min(8, Math.max(1, current * factor)).toFixed(2));
        });
        return;
      }
      // 若处于轨头内部且轨道区可纵向滚动，保留正常的垂直滚动浏览声部。
      if (target?.closest('.score-track-head') && element.scrollHeight > element.clientHeight) {
        return;
      }
      // 检查事件目标到滚动容器之间是否有自身的纵向滚动容器。
      let node = target;
      while (node && node !== element) {
        if (node.scrollHeight > node.clientHeight) {
          const overflowY = window.getComputedStyle(node).overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') return;
        }
        node = node.parentElement;
      }
      if (element.scrollWidth > element.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        element.scrollLeft += e.deltaY;
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const seekAt = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total);
  };
  const laneActual = Math.max(0, scrollerMetrics.scrollWidth - scrollerMetrics.headWidth);
  const playheadOffset = progress * laneActual;
  // 往右滑时间轴时，若播放位置已滚入轨头左侧（移出可见音轨区），指针应当隐藏；右侧超出可视区也隐藏。
  const isPlayheadVisible = !!playhead && (
    scrollerMetrics.headWidth === 0 || (
      playheadOffset >= scrollLeft - 1 &&
      (scrollerMetrics.clientWidth === 0 || playheadOffset <= scrollLeft + scrollerMetrics.clientWidth - scrollerMetrics.headWidth + 1)
    )
  );
  return <VStack className="score-arrangement" data-readonly={readOnly || undefined} gap={0} role="group" aria-label={label}>
    <VStack className="score-scroll" ref={scroller} gap={0}>
      <VStack className="score-content" gap={0} style={{ '--score-lane': laneExpr, width: `calc(var(--score-head) + ${laneExpr})` } as CSSProperties}>
        <HStack className="score-ruler-row" gap={0}>
          <HStack className="score-track-head score-ruler-head" gap={2} vAlign="center"><small className="score-ruler-total" title={t('@yovoice.score.tracks')}>{formatTime(total)}</small><TrackZoom value={zoom} change={setZoom} disabled={false} /></HStack>
          <HStack className="score-ruler grow" gap={0} role="list" aria-label={t('@yovoice.score.sections')} onPointerDown={playhead ? seekAt : undefined} data-seekable={!!playhead}>
            {sections.map((section, i) => {
              // 段落直接标在时间轴上：名称、起始时间与小节范围，变速段落附上速度。
              const start = scoreSeconds(score, section.start), end = scoreSeconds(score, section.end + 1);
              const detail = `${t('@yovoice.score.bars', { start: section.start, end: section.end })}${section.tempo ? ` · ${section.tempo} BPM` : ''}`;
              return <VStack key={`${i}-${section.start}`} className="score-ruler-section" role="listitem" data-odd={i % 2 === 1} gap={0} style={{ flexGrow: Math.max(.01, end - start) } as CSSProperties}>
                <b>{section.name || ' '}</b><small>{formatTime(start)} · {detail}</small>
              </VStack>;
            })}
          </HStack>
        </HStack>
        {score.tracks.map((track, index) => <HStack key={track.id} className="score-track" data-role={track.role ?? 'other'} data-muted={!!track.mute} aria-current={track.id === selected ? 'true' : undefined} gap={0}
          style={{ '--track-index': Math.min(index, 12) } as CSSProperties} onPointerDown={() => select(track.id)}>
          <HStack className="score-track-head" gap={0.5} vAlign="center">
            {readOnly ? <><Circle className="score-role-dot" aria-hidden="true" /><b className="score-track-name" onPointerEnter={overflowTitle}>{track.name}</b></> : <>
            <DropdownMenu hasChevron={false} button={{ size: 'sm', variant: 'ghost', isIconOnly: true, className: 'score-role-button', icon: <Circle className="score-role-dot" />, label: t('@yovoice.score.roleOf', { name: track.name }) }}
              items={scoreRoles.map(role => ({ label: roleLabel(role), icon: <Circle className="score-role-dot" data-role={role} />, endContent: role === (track.role ?? 'other') ? <Check size={14} aria-hidden /> : undefined, onClick: () => updateTrack(track.id, { role, level: undefined }) }))} />
            <b className="score-track-name" onPointerEnter={overflowTitle}>{track.name}</b>
            {/* 音色不占宽度：只显示图标，点开后可搜索选择，当前音色放在提示里。 */}
            {track.drums ? <Drum className="score-drum-kit" role="img" aria-hidden={false} aria-label={t('@yovoice.score.drumKit')}><title>{t('@yovoice.score.drumKit')}</title></Drum>
              : <Selector label={t('@yovoice.score.instrumentOf', { name: track.name })} isLabelHidden size="sm" variant="ghost" hasSearch className="score-instrument" value={String(track.program)}
                options={gmPrograms.map((name, program) => ({ value: String(program), label: name }))} renderValue={option => <Piano size={14} aria-label={option.label} role="img"><title>{option.label}</title></Piano>}
                onChange={value => updateTrack(track.id, { program: Number(value) })} />}
            {/* 电平只接受 -60 到 -1 dB：0 表示未设置，所以上限是 -1。 */}
            <label className="number-field compact" title={t('@yovoice.score.levelOf', { name: track.name })}><input type="number" aria-label={t('@yovoice.score.levelOf', { name: track.name })} min={-60} max={-1} step={1} value={targetLevel(track)} onChange={event => { const level = Number(event.target.value); if (level >= -60 && level < 0) updateTrack(track.id, { level }); }} /><small aria-hidden="true">dB</small></label>
            <Button size="sm" variant="ghost" isIconOnly className="score-mute" aria-pressed={!track.mute} icon={track.mute ? <VolumeX /> : <Volume2 />}
              label={t('@yovoice.score.playTrack', { name: track.name })} tooltip={t('@yovoice.score.playTrack', { name: track.name })} onClick={() => updateTrack(track.id, { mute: !track.mute || undefined })} />
            </>}
          </HStack>
          <ScoreLane score={score} track={track} zoom={zoom} />
        </HStack>)}
        {isPlayheadVisible ? <i className="score-playhead" style={{ left: `calc(var(--score-head) + var(--score-lane) * ${progress})` }} aria-hidden="true" /> : null}
      </VStack>
    </VStack>
  </VStack>;
}

// 底部轨道区：和下方音轨一样横向贯穿整个工作区（含检查器下方），播放器紧随其下。
export function ScoreDock({ draft, change, playhead, seek }: {
  draft: Draft; change: (patch: Partial<Draft>) => void; playhead?: { time: number; playing: boolean }; seek: (time: number) => void;
}) {
  const t = useTranslator();
  const [selected, setSelected] = useState<string>();
  const score = draft.score;
  const notes = score ? noteCount(score) : 0;
  if (!score || !notes) return null;
  const updateTrack = (id: string, patch: Partial<ScoreTrack>) => change({ score: { ...score, tracks: score.tracks.map(track => track.id === id ? { ...track, ...patch } : track) } });
  return <ScoreArrangement score={score} selected={selected} select={setSelected} updateTrack={updateTrack} playhead={playhead} seek={seek} label={t('@yovoice.score.rollLabel', { tracks: score.tracks.length, notes })} />;
}
