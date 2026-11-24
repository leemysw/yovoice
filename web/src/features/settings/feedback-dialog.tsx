import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
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
  return <AppDialog title={t('@yovoice.feedback.title')} width={480} busy={busy} error={error} onClose={close}
    actions={<>
      <Button label={t(exported ? '@yovoice.feedback.exportAgain' : '@yovoice.feedback.export')} isLoading={busy} onClick={() => void exportBundle()} />
      <Button label={t('@yovoice.feedback.openIssue')} variant={exported ? 'primary' : 'secondary'} isDisabled={!summary} href={summary?.issueUrl} target="_blank" rel="noreferrer" onClick={close} />
    </>}>
    <VStack gap={3}>
      {summary?.crash ? <p className="dialog-error">{t(summary.crash.kind === 'engine' ? '@yovoice.feedback.engineCrashed' : '@yovoice.feedback.serviceCrashed')}</p> : null}
      <ol className="feedback-steps">
        <li>{t('@yovoice.feedback.stepExport')}</li>
        <li>{t('@yovoice.feedback.stepIssue')}</li>
        <li>{t('@yovoice.feedback.stepAttach')}</li>
      </ol>
      <small className="asset-muted">{t('@yovoice.feedback.privacy')}</small>
    </VStack>
  </AppDialog>;
}
