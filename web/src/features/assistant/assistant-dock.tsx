import type { CSSProperties } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { X } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Kbd } from '@astryxdesign/core/Kbd';
import { useTranslator } from '@astryxdesign/core/i18n';
import type { AssistantContext, State } from '../../shared/workbench';
import { usePanelFrame } from './assistant-frame';
import { useAssistantLive } from '../../shared/lib/assistant-live';
import { turnActivity, turnPhase } from './assistant-model';
import { AssistantAvatar, AssistantOrb } from './assistant-avatar';
import { AssistantPanel, type AssistantPanelActions, type QuickAction } from './assistant-panel';
import { AssistantNudge } from './assistant-nudge';
import type { Nudge } from './use-assistant-nudge';

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
  if (open) {
    return <AssistantPanel state={state} context={context} expanded={expanded} quickActions={quickActions} frame={frame}
      style={{ '--assistant-right': `${frame.rect.right}px`, '--assistant-bottom': `${frame.rect.bottom}px`, '--assistant-width': `${frame.rect.width}px`, '--assistant-height': `${frame.rect.height}px` } as CSSProperties}
      onToggleExpand={onToggleExpand} onClose={() => { setOpen(false); showLauncher(true); }} actions={actions} />;
  }
  const turn = live?.turn;
  const phase = turn ? turnPhase(turnActivity(turn.blocks ?? [])) : null;
  const label = phase ? t(`@yovoice.assistant.phase.${phase}`) : t('@yovoice.assistant.launch');
  // 主动提示停在入口上方；入口被移走时气泡单独停在右下角。
  const bubble = nudge ? <AssistantNudge nudge={nudge} launcher={!launcherHidden} onAct={onNudge} onClose={dismissNudge} /> : null;
  if (launcherHidden) return bubble;
  // 入口悬停时右上角出现 ×，可以移走；之后从标题栏右上角或 ⌘J 打开，在浮窗里点收起时入口重新出现。
  return <>{bubble}<HStack className="assistant-launcher-wrap" gap={0} data-running={turn ? 'true' : undefined}>
    <Button data-testid="assistant-toggle" className="assistant-launcher"
      label={label} variant="secondary" aria-expanded={false} aria-keyshortcuts="Control+J"
      icon={<AssistantAvatar working={!!turn} size={22} />}
      endContent={phase ? <AssistantOrb phase={phase} /> : <Kbd keys="mod+J" />} onClick={() => setOpen(true)} />
    <Button data-testid="assistant-launcher-hide" className="assistant-launcher-hide" size="sm" variant="secondary" isIconOnly icon={<X size={12} />}
      label={t('@yovoice.assistant.hideLauncher')} tooltip={t('@yovoice.assistant.hideLauncherHint')} onClick={hideLauncher} />
  </HStack></>;
}

/** 浏览器预览标题栏右上角的入口：会动的 Ocho，助手运行时蹦跳。桌面版由原生标题栏提供同样的入口。 */
export function AssistantTitleButton({ open, toggle }: { open: boolean; toggle: () => void }) {
  const t = useTranslator();
  const live = useAssistantLive();
  return <Button data-testid="titlebar-assistant" className="assistant-title-button" label={t('@yovoice.assistant.title')} tooltip={t('@yovoice.assistant.toggleHint')} isIconOnly variant="ghost" size="sm"
    icon={<AssistantAvatar working={!!live?.turn} size={22} />} aria-expanded={open} aria-keyshortcuts="Control+J" onClick={toggle} />;
}
