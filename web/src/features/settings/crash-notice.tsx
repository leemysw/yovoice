import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { CircleAlert, X } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { readLocal, writeLocal } from '../../shared/lib/local-store';
import type { DiagnosticReport } from '../../shared/workbench';
import { useAppUpdate } from '../update/app-update';
import { FeedbackDialog } from './feedback-dialog';

const seenKey = 'yovoice-crash-seen';

// 启动后查一次诊断摘要：上次没有正常退出或推理引擎意外退出时提示一次，可直接反馈问题；关掉后同一次异常不再提示。
export function CrashNotice() {
  const t = useTranslator();
  const version = useAppUpdate()?.current ?? '';
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let alive = true;
    // 摘要只用于提示，读取失败时不打扰用户。
    call<DiagnosticReport>('diagnostics.report', { version }).then(value => { if (alive) setReport(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [version]);
  const crash = report?.crash;
  if (!crash || hidden || readLocal(seenKey) === crash.time) return open && report ? <FeedbackDialog report={report} close={() => setOpen(false)} /> : null;
  const dismiss = () => { writeLocal(seenKey, crash.time); setHidden(true); };
  return <>
    <HStack className="notice" role="status" gap={3} hAlign="between" vAlign="center" data-testid="crash-notice">
      <CircleAlert className="notice-icon" aria-hidden />
      <p className="grow">{t(crash.kind === 'engine' ? '@yovoice.feedback.engineCrashed' : '@yovoice.feedback.serviceCrashed')}</p>
      <Button size="sm" label={t('@yovoice.feedback.report')} onClick={() => { dismiss(); setOpen(true); }} />
      <Button label={t('@yovoice.action.closeNotice')} size="sm" variant="ghost" isIconOnly icon={<X size={16} />} onClick={dismiss} />
    </HStack>
    {open && report ? <FeedbackDialog report={report} close={() => setOpen(false)} /> : null}
  </>;
}
