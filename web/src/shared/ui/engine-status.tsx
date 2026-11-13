import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Check, LoaderCircle } from 'lucide-react';
import { formatActivity } from '../i18n/format';
import { useEngineStatus } from '../lib/use-engine-status';
import { useElapsed } from '../lib/use-elapsed';
import { formatTime, type Activity } from '../workbench';

const phases = {
  stopped: '@yovoice.runtime.modelAbsent',
  starting: '@yovoice.activity.engineStart',
  ready: '@yovoice.runtime.modelReady',
  unloaded: '@yovoice.runtime.modelUnloaded',
  unloading: '@yovoice.runtime.modelUnloading',
  unknown: '@yovoice.runtime.statusUnknown',
} as const;

export function EngineStatus({ activity, modelId, policy = false }: { activity?: Activity | null; modelId?: string; policy?: boolean }) {
  const t = useTranslator();
  const generating = activity?.status === 'running';
  const status = useEngineStatus(generating);
  const elapsed = useElapsed(generating, activity?.startedAt);
  let label = activity ? formatActivity(t, activity) : '';
  if (activity?.code === '@yovoice.activity.synthesizing' && status && status.phase !== 'unknown') {
    label = t(status.phase === 'ready' && status.modelId === modelId ? '@yovoice.activity.synthesisRunning' : '@yovoice.activity.modelLoading');
  }
  // 多句或多候选有真实总量；单次离线请求没有总步数，沿用等待态而不按时间推算百分比。
  const determinate = activity && activity.total > 1;
  return <VStack gap={2} data-testid="engine-status">
    {status ? <HStack gap={2} vAlign="center">
      {status.phase === 'ready' ? <Check size={14} aria-hidden /> : null}
      <small role="status">{status.modelName ? `${status.modelName} · ` : ''}{t(phases[status.phase] ?? phases.unknown)}</small>
    </HStack> : null}
    {generating && activity ? <>
      <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden />
        <small className="grow" role="status">{label}</small>
        <small className="generation-elapsed" aria-label={t('@yovoice.create.elapsed')}>{formatTime(elapsed)}</small>
      </HStack>
      <ProgressBar label={label} isLabelHidden isIndeterminate={!determinate} value={activity.received} max={activity.total || 1} />
    </> : null}
    {policy && status && status.phase !== 'unknown' ? <small>{status.idleUnloadSeconds > 0
      ? t('@yovoice.runtime.idlePolicy', { seconds: status.idleUnloadSeconds })
      : t('@yovoice.runtime.idleDisabled')}</small> : null}
  </VStack>;
}
