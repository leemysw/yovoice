import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslator, type TranslatorFn } from '@astryxdesign/core/i18n';
import type { Activity, Draft, State } from '../../shared/workbench';

// Ocho 的主动提示：生成完成或失败、模型或引擎下载结束时，在右下角入口上方冒出一个小气泡，
// 给一句话和一个动作；点动作即打开面板并替用户发出对应的请求。面板开着、关闭了主动提示或助手不可用时不出现。
// 这里只有判断与状态，不引入助手形象，外壳首屏可以直接使用；气泡本身在 assistant-nudge.tsx，随助手分块按需加载。

export interface Nudge { id: string; tone: 'success' | 'danger'; text: string; action: string; prompt: string }

// 完成类提示的最小间隔：连续生成时不反复打扰；失败总是提示。
const successInterval = 3 * 60 * 1000;
const visibleFor = 20 * 1000;

/** 根据一次操作的结束生成提示；不需要提示时返回 null。 */
export function nudgeFor(t: TranslatorFn, activity: Activity, drafts: Draft[]): Nudge | null {
  const id = `${activity.kind}:${activity.startedAt}:${activity.status}`;
  if (activity.kind === 'generate') {
    // 出谱、扒谱这类中间步骤结果就在编辑器里，不另外提示。
    if (activity.code !== '@yovoice.activity.generate') return null;
    if (activity.status === 'failed') return { id, tone: 'danger', text: t('@yovoice.assistant.nudge.failed'), action: t('@yovoice.assistant.nudge.diagnose'), prompt: t('@yovoice.assistant.nudge.failedPrompt') };
    if (activity.status !== 'completed') return null;
    const draft = drafts.find(item => item.id === activity.projectId);
    const kind = draft?.kind === 'music' || draft?.kind === 'score' || draft?.kind === 'sfx' ? draft.kind : draft?.subtitles ? 'story' : 'text';
    return { id, tone: 'success', text: t(`@yovoice.assistant.nudge.done.${kind}`), action: t('@yovoice.assistant.nudge.improve'), prompt: t(`@yovoice.assistant.nudge.donePrompt.${kind}`) };
  }
  if (activity.kind === 'download' || activity.kind === 'runtime') {
    if (activity.status === 'failed') return { id, tone: 'danger', text: t('@yovoice.assistant.nudge.downloadFailed'), action: t('@yovoice.assistant.nudge.diagnose'), prompt: t('@yovoice.assistant.nudge.downloadFailedPrompt') };
    if (activity.status !== 'completed' || activity.kind !== 'download') return null;
    const name = typeof activity.params?.name === 'string' ? activity.params.name : activity.modelId ?? '';
    return { id, tone: 'success', text: t('@yovoice.assistant.nudge.modelReady', { name }), action: t('@yovoice.assistant.nudge.tryIt'), prompt: t('@yovoice.assistant.nudge.modelReadyPrompt', { name }) };
  }
  return null;
}

/** 监听生成与下载的结束，返回当前要显示的提示。只认运行中 → 结束的变化，启动时已结束的旧状态不提示。 */
export function useAssistantNudge(state: State, enabled: boolean): [Nudge | null, () => void] {
  const t = useTranslator();
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const running = useRef<Record<string, string>>({});
  const lastSuccess = useRef(0);
  const observe = useEffectEvent((slot: string, activity: Activity | null | undefined) => {
    if (!activity) return;
    const key = `${activity.kind}:${activity.startedAt}`;
    if (activity.status === 'running') { running.current[slot] = key; return; }
    if (running.current[slot] !== key) return;
    delete running.current[slot];
    if (!enabled) return;
    const next = nudgeFor(t, activity, state.drafts);
    if (!next) return;
    if (next.tone === 'success') {
      if (Date.now() - lastSuccess.current < successInterval) return;
      lastSuccess.current = Date.now();
    }
    setNudge(next);
  });
  useEffect(() => observe('activity', state.activity), [state.activity]);
  useEffect(() => observe('model', state.modelActivity), [state.modelActivity]);
  useEffect(() => { if (!enabled) setNudge(null); }, [enabled]);
  useEffect(() => {
    if (!nudge) return;
    const timer = window.setTimeout(() => setNudge(current => current?.id === nudge.id ? null : current), visibleFor);
    return () => window.clearTimeout(timer);
  }, [nudge]);
  return [nudge, () => setNudge(null)];
}
