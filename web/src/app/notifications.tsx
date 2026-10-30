import { useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { formatBytes, stableJSON, type Activity, type AITask } from '../shared/workbench';
import { formatActivity, formatActivityError, formatNotice } from '../shared/i18n/format';
import { readLocal, writeLocal } from '../shared/lib/local-store';

function NoticeText({ error, activity }: { error: string; activity: Activity | null | undefined }) {
  const t = useTranslator();
  if (error) return <>{formatNotice(t, error)}</>;
  return <>{formatActivityError(t, activity) ?? t('@yovoice.error.unknown')}</>;
}

function ActivityLabel({ activity }: { activity: Activity }) {
  const t = useTranslator();
  return <strong data-testid="activity-label">{formatActivity(t, activity)}</strong>;
}


// 不在对应作品时的 AI 任务提示：写作在后台继续，写好或失败后可一键回到作品处理。
function AITaskNotice({ task, title, open }: { task: AITask; title?: string; open: () => void }) {
  const t = useTranslator();
  const state = task.status === 'running' ? 'running' : task.status === 'completed' ? 'done' : 'failed';
  const icon = state === 'running' ? <LoaderCircle size={16} className="generation-spinner" aria-hidden /> : state === 'done' ? <Check size={16} aria-hidden /> : <CircleAlert size={16} className="notice-icon" aria-hidden />;
  return <HStack className="notice ai-notice" data-status={state} role="status" gap={3} vAlign="center">
    {icon}<p className="grow">{t(`@yovoice.ai.task.${state}.${task.kind}`)}{title ? <small> · {title}</small> : null}</p>
    <Button size="sm" variant={state === 'running' ? 'ghost' : 'secondary'} label={t('@yovoice.ai.openProject')} onClick={open} />
  </HStack>;
}

// 全局错误提示与后台任务进度；关闭的失败任务按内容记忆，不再重复提示。
export function Notifications({ error, clearError, activity, modelActivity, draftId, page, cancel, cancelModel, aiTask, aiTitle, openAITask, children }: { children?: ReactNode; error: string; clearError: () => void; activity: Activity | null; modelActivity?: Activity | null; draftId: string; page: string; cancel: () => void; cancelModel: () => void; aiTask?: AITask; aiTitle?: string; openAITask: () => void }) {
  const t = useTranslator();
  const [dismissedActivity, setDismissedActivity] = useState(() => readLocal('yovoice-dismissed-task') ?? '');
  // 模型失败与生成失败分开记忆：共用一个键时关闭其中一个，另一个已关闭的提示会重新出现。
  const [dismissedModel, setDismissedModel] = useState(() => readLocal('yovoice-dismissed-model-task') ?? '');
  const activityKey = activity ? stableJSON(activity) : '';
  const busy = activity?.status === 'running';
  // 模型下载与导入与生成并行：导入进度在这里展示，下载进度在模型列表中展示；失败在任何页面都提示一次。
  const modelKey = modelActivity ? stableJSON(modelActivity) : '';
  const modelFailed = modelActivity?.status === 'failed' && modelKey !== dismissedModel;
  const dismissModel = (key: string) => { setDismissedModel(key); writeLocal('yovoice-dismissed-model-task', key); };
  return <VStack className="notifications" gap={2}>
      {modelFailed && !error ? <HStack className="notice" role="alert" gap={3} hAlign="between" vAlign="center"><CircleAlert className="notice-icon" aria-hidden /><p className="grow"><NoticeText error="" activity={modelActivity} /></p><Button label={t('@yovoice.action.closeNotice')} size="sm" variant="ghost" isIconOnly icon={<X size={16} />} onClick={() => dismissModel(modelKey)} /></HStack> : null}
      {error || (activity?.status === 'failed' && !activity.characterId && (!activity.projectId || activity.projectId === draftId) && page === 'create' && activityKey !== dismissedActivity) ? <HStack className="notice" role="alert" gap={3} hAlign="between" vAlign="center"><CircleAlert className="notice-icon" aria-hidden /><p className="grow"><NoticeText error={error} activity={activity} /></p><Button label={t('@yovoice.action.closeNotice')} size="sm" variant="ghost" isIconOnly icon={<X size={16} />} onClick={() => { clearError(); if (activity?.status === 'failed') { setDismissedActivity(activityKey); writeLocal('yovoice-dismissed-task', activityKey); } }} /></HStack> : null}
      {busy && activity && !['download', 'generate'].includes(activity.kind) ? <HStack className="activity" role="status" gap={3} vAlign="center"><VStack className="grow" gap={2}><HStack hAlign="between"><ActivityLabel activity={activity} />{activity.total > 0 ? <small>{formatBytes(activity.received)} / {formatBytes(activity.total)}</small> : null}</HStack><progress value={activity.total > 0 ? activity.received : undefined} max={activity.total || 1} /></VStack><Button label={activity.kind === 'download' ? t('@yovoice.action.pause') : t('@yovoice.action.cancel')} size="sm" onClick={cancel} /></HStack> : null}
      {modelActivity?.status === 'running' && modelActivity.kind === 'import' ? <HStack className="activity" role="status" gap={3} vAlign="center"><VStack className="grow" gap={2}><ActivityLabel activity={modelActivity} /><progress max={1} /></VStack><Button label={t('@yovoice.action.cancel')} size="sm" onClick={cancelModel} /></HStack> : null}
      {aiTask && aiTask.kind !== 'cast' && aiTask.status !== 'cancelled' && (page !== 'create' || aiTask.projectId !== draftId) ? <AITaskNotice task={aiTask} title={aiTitle} open={openAITask} /> : null}
      {children}
  </VStack>;
}
