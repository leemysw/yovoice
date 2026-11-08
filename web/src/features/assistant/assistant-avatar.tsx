import { useEffect, useState } from 'react';
import { BotAvatar } from 'bot-avatars';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import type { TurnPhase } from './assistant-model';

// 空闲时每隔一段时间“醒来”张望一下的间隔与时长（毫秒）。
const glanceEvery = 18000;
const glanceFor = 2600;

// Ocho 的形象：一只毛绒小幽灵（bot-avatars 的 ghost），身体取应用的强调色（暖橙），与 yovoice 的配色一致。
// awake 由外层传入（如鼠标停在入口按钮上）。形象是逐帧绘制的画布，一直动会持续占用 CPU：只在工作、悬停或偶尔张望时动，其余时间停在当前帧；
// 窗口隐藏或失去焦点时也停下。
export function AssistantAvatar({ working, size, awake = false }: { working: boolean; size: number; awake?: boolean }) {
  const [color] = useState(accentColor);
  const [hovered, setHovered] = useState(false);
  const [glancing, setGlancing] = useState(false);
  const visible = useWindowActive();
  useEffect(() => {
    if (!visible || working) return;
    let stop = 0;
    const timer = window.setInterval(() => { setGlancing(true); stop = window.setTimeout(() => setGlancing(false), glanceFor); }, glanceEvery);
    return () => { window.clearInterval(timer); window.clearTimeout(stop); setGlancing(false); };
  }, [visible, working]);
  const paused = !visible || !(working || awake || hovered || glancing);
  return <BotAvatar className="assistant-avatar" type="ghost" color={color} state={working ? 'working' : 'default'} size={size} paused={paused}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} aria-hidden />;
}

// 窗口在前台且可见时为 true；切到后台、最小化或失去焦点时为 false。
function useWindowActive() {
  const read = () => !document.hidden && document.hasFocus();
  const [active, setActive] = useState(read);
  useEffect(() => {
    const update = () => setActive(read());
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('blur', update); };
  }, []);
  return active;
}

// accentColor 把主题强调色变量解析成画布能用的颜色值（画布不认 CSS 变量）。
function accentColor(): string {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;visibility:hidden;color:var(--app-accent)';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || 'orange';
}

// 每个阶段一种点阵：思考是分层翻转的球，回复是起伏的彩带，查找是扫描的地球，
// 改作品是轮廓在圆、三角、方之间变形，生成音频是一圈圈滚动的声波，打开或切换是连线的星座，其余是绕轨道的粒子。
const phaseOrbs: Record<TurnPhase, OrbState> = {
  thinking: 'solving', writing: 'composing', searching: 'searching', editing: 'shaping', generating: 'listening', opening: 'connecting', working: 'working',
};

/** 运行中的状态点，与旁边带流光的阶段文字一起说明此刻在做什么。对话里用 32px，入口按钮里用 20px。 */
export function AssistantOrb({ phase, size = 20 }: { phase: TurnPhase; size?: 20 | 32 }) {
  return <ThinkingOrb className="assistant-orb" state={phaseOrbs[phase]} size={size} theme="auto" aria-hidden="true" />;
}
