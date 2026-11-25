import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { Step, Stepper } from '@astryxdesign/core/Stepper';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ExternalLink } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { AppDialog } from '../../shared/ui/app-dialog';
import type { DiagnosticReport } from '../../shared/workbench';
import { useAppUpdate } from '../update/app-update';

// 反馈问题：先导出诊断包（日志、推理引擎错误输出与系统崩溃报告，主目录已替换为 ~），再打开预填了版本、
// 系统、内核与最近错误码的 GitHub issue，用户把诊断包拖进描述框即可。GitHub 不支持通过地址附带文件，只能手动拖入。
export function FeedbackDialog({ report, close }: { report?: DiagnosticReport | null; close: () => void }) {
  const t = useTranslator();
  const version = useAppUpdate()?.current ?? '';
  const [summary, setSummary] = useState<DiagnosticReport | null>(report ?? null);
  const [exported, setExported] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (report) return;
    let alive = true;
    call<DiagnosticReport>('diagnostics.report', { version }).then(value => { if (alive) setSummary(value); }).catch(e => { if (alive) setError(noticeMessage(e)); });
    return () => { alive = false; };
  }, [report, version]);
  const exportBundle = async () => {
    setBusy(true); setError('');
    // 宿主弹出保存位置；用户取消时返回 false，不算导出。
    try { if (await call<boolean>('logs.export', { version }) !== false) setExported(true); } catch (e) { setError(noticeMessage(e)); } finally { setBusy(false); }
  };
  // 第一步导出、第二步打开 issue、第三步在浏览器里完成；每一步的按钮放在步骤里，顺序一眼可见。
  const step = opened ? 2 : exported ? 1 : 0;
  return <AppDialog title={t('@yovoice.feedback.title')} width={480} busy={busy} error={error} onClose={close}>
    {summary?.crash ? <Banner status="warning" title={t(summary.crash.kind === 'engine' ? '@yovoice.feedback.engineCrashed' : '@yovoice.feedback.serviceCrashed')} /> : null}
    <Stepper className="feedback-steps" orientation="vertical" activeStep={step} label={t('@yovoice.feedback.title')}>
      <Step step={0} label={t('@yovoice.feedback.export')} description={t('@yovoice.feedback.stepExport')}>
        <Button size="sm" label={t(exported ? '@yovoice.feedback.exportAgain' : '@yovoice.feedback.save')} variant={exported ? 'secondary' : 'primary'} isLoading={busy} onClick={() => void exportBundle()} />
      </Step>
      <Step step={1} label={t('@yovoice.feedback.openIssue')} description={t('@yovoice.feedback.stepIssue')}>
        <Button size="sm" label={t('@yovoice.feedback.open')} variant={exported && !opened ? 'primary' : 'secondary'} icon={<ExternalLink />} isDisabled={!summary} href={summary?.issueUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)} />
      </Step>
      <Step step={2} label={t('@yovoice.feedback.attach')} description={t('@yovoice.feedback.stepAttach')} />
    </Stepper>
    <small className="asset-muted">{t('@yovoice.feedback.privacy')}</small>
  </AppDialog>;
}
