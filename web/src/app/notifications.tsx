import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { CircleAlert, X } from 'lucide-react';
import { formatSize, stableJSON, type Activity } from '../shared/workbench';
import { formatActivity, formatActivityError, formatNotice } from '../shared/i18n/format';

function NoticeText({ error, activity }: { error: string; activity: Activity | null | undefined }) {
  const t = useTranslator();
  if (error) return <>{formatNotice(t, error)}</>;
  return <>{formatActivityError(t, activity) ?? t('@yovoice.error.unknown')}</>;
}

function ActivityLabel({ activity }: { activity: Activity }) {
  const t = useTranslator();
  return <strong data-testid="activity-label">{formatActivity(t, activity)}</strong>;
}


// 全局错误提示与后台任务进度；关闭的失败任务按内容记忆，不再重复提示。
export function Notifications({ error, clearError, activity, draftId, page, cancel }: { error: string; clearError: () => void; activity: Activity | null; draftId: string; page: string; cancel: () => void }) {
  const t = useTranslator();
  const [dismissedActivity, setDismissedActivity] = useState(() => localStorage.getItem('yovoice-dismissed-task') ?? '');
  const activityKey = activity ? stableJSON(activity) : '';
  const busy = activity?.status === 'running';
  return <VStack className="notifications" gap={2}>
      {error || (activity?.status === 'failed' && !activity.characterId && (!activity.projectId || activity.projectId === draftId) && page === 'create' && activityKey !== dismissedActivity) ? <HStack className="notice" role="alert" gap={3} hAlign="between" vAlign="center"><CircleAlert className="notice-icon" aria-hidden /><p className="grow"><NoticeText error={error} activity={activity} /></p><Button label={t('@yovoice.action.closeNotice')} size="sm" variant="ghost" isIconOnly icon={<X size={16} />} onClick={() => { clearError(); if (activity?.status === 'failed') { setDismissedActivity(activityKey); localStorage.setItem('yovoice-dismissed-task', activityKey); } }} /></HStack> : null}
      {busy && activity && !['download', 'generate'].includes(activity.kind) ? <HStack className="activity" role="status" gap={3} vAlign="center"><VStack className="grow" gap={2}><HStack hAlign="between"><ActivityLabel activity={activity} />{activity.total > 0 ? <small>{formatSize(activity.received)} / {formatSize(activity.total)}</small> : null}</HStack><progress value={activity.total > 0 ? activity.received : undefined} max={activity.total || 1} /></VStack><Button label={activity.kind === 'download' ? t('@yovoice.action.pause') : t('@yovoice.action.cancel')} size="sm" onClick={cancel} /></HStack> : null}
  </VStack>
}
