import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { X } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { useTranslator } from '@astryxdesign/core/i18n';
import type { AssistantContext, State } from '../../shared/workbench';
import { usePanelFrame } from './assistant-frame';
import { useAssistantLive } from '../../shared/lib/assistant-live';
import { turnActivity, turnPhase } from './assistant-model';
import { AssistantAvatar, AssistantOrb } from './assistant-avatar';
import type { AssistantPanelActions, QuickAction } from './assistant-panel';
import { AssistantNudge } from './assistant-nudge';
import type { Nudge } from './use-assistant-nudge';
import { call } from '../../shared/lib/client';
import { activeBinding, useHotkey, useHotkeyAria, useHotkeyText } from '../../shared/hotkeys/hotkeys';
import { HotkeyKeys } from '../../shared/hotkeys/hotkey-keys';

// 浮窗带对话与 Markdown 渲染，体积较大：入口先出现，浮窗按需加载；悬停、聚焦入口或启动后空闲时提前取好，打开时不必等。
const loadPanel = () => import('./assistant-panel');
const AssistantPanel = lazy(() => loadPanel().then(module => ({ default: module.AssistantPanel })));
const preloadPanel = () => { void loadPanel(); };

// 助手停靠位：收起时是右下角的小入口（Ocho 形象 + 名称，运行中显示此刻在做什么），可移走，移走后才由标题栏右上角接替入口，
// 展开后是浮窗；浮窗可拖动、缩放、拉高，位置单独记住，入口始终停在右下角。

export function AssistantDock({ state, open, setOpen, context, expanded, quickActions, onToggleExpand, actions, launcherHidden, showLauncher, nudge, onNudge, dismissNudge }: {
  state: State; open: boolean; setOpen: (open: boolean) => void; context: AssistantContext; expanded: boolean; quickActions: QuickAction[];
  onToggleExpand: () => void; actions: AssistantPanelActions; launcherHidden: boolean; showLauncher: (show: boolean) => void;
  nudge: Nudge | null; onNudge: (nudge: Nudge) => void; dismissNudge: () => void;
}) {
  const t = useTranslator();
  const frame = usePanelFrame();
  const live = useAssistantLive();
  const hideLauncher = () => showLauncher(false);
  const [hovered, setHovered] = useState(false);
  // 开关 Ocho 的按键跟随快捷键设置；清除后入口不再显示按键。useHotkeyText 订阅设置变化，activeBinding 取同一时刻的按键写法。
  const toggleKeys = useHotkeyText('global.assistant'), toggleAria = useHotkeyAria('global.assistant');
  const toggleBinding = toggleKeys ? activeBinding('global.assistant') : '';
  // 取消键在面板外（含面板收起时）停止 Ocho 的回复，但只是兜底：当前页面有录音、上传或生成等任务时先停那些；焦点在面板里时由面板自己的注册处理。
  useHotkey('global.cancel', () => { void call('assistant.cancel').catch(() => undefined); }, { enabled: !!live?.turn, fallback: true });
  // 输入框里还没发出的草稿放在常驻的停靠位里：用 Esc、快捷键或收起按钮收起面板，再打开时仍在。
  const [draft, setDraft] = useState('');
  // 启动时恢复打开的面板不抢焦点；之后每次打开（快捷键、入口、主动提示）都把焦点放进面板。
  const [restored, setRestored] = useState(open);
  if (restored && !open) setRestored(false);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 3000));
    const handle = idle(preloadPanel);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(handle); else window.clearTimeout(handle); };
  }, []);
  if (open) {
    return <Suspense fallback={null}><AssistantPanel state={state} context={context} expanded={expanded} quickActions={quickActions} frame={frame} draft={draft} setDraft={setDraft} focusOnOpen={!restored}
      style={{ '--assistant-right': `${frame.rect.right}px`, '--assistant-bottom': `${frame.rect.bottom}px`, '--assistant-width': `${frame.rect.width}px`, '--assistant-height': `${frame.rect.height}px` } as CSSProperties}
      onToggleExpand={onToggleExpand} onClose={() => { setOpen(false); showLauncher(true); }} actions={actions} /></Suspense>;
  }
  const turn = live?.turn;
  const phase = turn ? turnPhase(turnActivity(turn.blocks ?? [])) : null;
  const label = phase ? t(`@yovoice.assistant.phase.${phase}`) : t('@yovoice.assistant.launch');
  // 主动提示停在入口上方；入口被移走时气泡单独停在右下角。
  const bubble = nudge ? <AssistantNudge nudge={nudge} launcher={!launcherHidden} onAct={onNudge} onClose={dismissNudge} /> : null;
  if (launcherHidden) return bubble;
  // 入口悬停时右上角出现 ×，可以移走；之后从标题栏右上角或开关 Ocho 的快捷键打开，在浮窗里点收起时入口重新出现。
  return <>{bubble}<HStack className="assistant-launcher-wrap" gap={0} data-running={turn ? 'true' : undefined}
    onPointerEnter={() => { setHovered(true); preloadPanel(); }} onPointerLeave={() => setHovered(false)} onFocus={preloadPanel}>
    <Button data-testid="assistant-toggle" className="assistant-launcher"
      label={label} variant="secondary" aria-expanded={false} aria-keyshortcuts={toggleAria}
      icon={<AssistantAvatar working={!!turn} awake={hovered} size={22} />}
      endContent={phase ? <AssistantOrb phase={phase} /> : toggleBinding ? <HotkeyKeys className="assistant-launcher-keys" binding={toggleBinding} /> : undefined} onClick={() => setOpen(true)} />
    <Button data-testid="assistant-launcher-hide" className="assistant-launcher-hide" size="sm" variant="secondary" isIconOnly icon={<X size={12} />}
      label={t('@yovoice.assistant.hideLauncher')} tooltip={toggleKeys ? t('@yovoice.assistant.hideLauncherHint', { keys: toggleKeys }) : t('@yovoice.assistant.hideLauncherHintPlain')} onClick={hideLauncher} />
  </HStack></>;
}

/** 浏览器预览标题栏右上角的入口：会动的 Ocho，助手运行时蹦跳。桌面版由原生标题栏提供同样的入口。 */
export function AssistantTitleButton({ open, toggle }: { open: boolean; toggle: () => void }) {
  const t = useTranslator();
  const live = useAssistantLive();
  const keys = useHotkeyText('global.assistant'), aria = useHotkeyAria('global.assistant');
  return <Button data-testid="titlebar-assistant" className="assistant-title-button" label={t('@yovoice.assistant.title')} tooltip={keys ? t('@yovoice.assistant.toggleHint', { keys }) : t('@yovoice.assistant.title')} isIconOnly variant="ghost" size="sm"
    icon={<AssistantAvatar working={!!live?.turn} size={22} />} aria-expanded={open} aria-keyshortcuts={aria} onClick={toggle} />;
}
