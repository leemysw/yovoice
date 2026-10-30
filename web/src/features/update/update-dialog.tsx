import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Spinner } from '@astryxdesign/core/Spinner';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { ArrowUpRight } from 'lucide-react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { formatCallError } from '../../shared/i18n/format';
import { checkForUpdate, formatBytes, installUpdate, releaseUrl, updatePercent, useAppUpdate, type AppUpdate } from './app-update';
import { ReleaseNotes } from './release-notes';
import { isUiLocale } from '../../shared/i18n/locale';

// 下载进度：已知大小时显示百分比与字节数，否则显示不确定进度。
export function UpdateProgress({ update }: { update: AppUpdate }) {
  const t = useTranslator();
  const percent = updatePercent(update);
  const verifying = update.status === 'verifying';
  return <VStack gap={1} className="update-progress">
    <ProgressBar label={verifying ? t('@yovoice.update.verifying') : t('@yovoice.update.downloading', { version: update.version ?? '' })} isLabelHidden
      value={percent ?? 0} isIndeterminate={verifying || percent === null} />
    <HStack hAlign="between" gap={2}>
      <small>{verifying ? t('@yovoice.update.verifying') : percent === null ? t('@yovoice.update.downloadStarting') : `${percent}%`}</small>
      {!verifying && update.total > 0 ? <small>{formatBytes(update.received)} / {formatBytes(update.total)}</small> : null}
    </HStack>
  </VStack>;
}

// 更新详情：版本、发布说明、下载进度和重启安装；宿主菜单“检查更新”与界面入口共用。
export function UpdateDialogHost() {
  const t = useTranslator();
  const current = useLocale();
  const locale = isUiLocale(current) ? current : 'en';
  const update = useAppUpdate();
  const [open, setOpen] = useState(false);
  // 检查或安装请求本身失败（宿主没有回应）时在对话框里说明；更新流程的失败由 update.status 表达。
  const [error, setError] = useState('');
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('workbench-show-update', show);
    return () => window.removeEventListener('workbench-show-update', show);
  }, []);
  if (!open || !update) return null;
  const close = () => setOpen(false);
  const act = (job: () => Promise<unknown>) => { setError(''); job().catch((e: unknown) => setError(formatCallError(t, e))); };
  const { status } = update;
  const busy = status === 'checking' || status === 'downloading' || status === 'verifying';
  const fresh = !!update.version && update.version !== update.current;
  const title = status === 'ready' ? t('@yovoice.update.readyTitle', { version: update.version ?? '' })
    : status === 'downloading' || status === 'verifying' ? t('@yovoice.update.foundTitle', { version: update.version ?? '' })
      : status === 'installing' ? t('@yovoice.update.installingTitle')
        : status === 'checking' ? t('@yovoice.update.checking')
          : status === 'failed' ? t('@yovoice.update.failedTitle')
            : status === 'latest' ? t('@yovoice.update.latestTitle')
              : t('@yovoice.update.title');
  const published = update.publishedAt ? new Date(update.publishedAt).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const versionLine = fresh ? t('@yovoice.update.versionChange', { current: update.current, version: update.version ?? '' }) : t('@yovoice.update.currentVersion', { version: update.current });
  const actions = status === 'ready' ? <>
    <Button label={t('@yovoice.update.later')} onClick={close} />
    <Button label={t('@yovoice.update.restart')} variant="primary" data-testid="update-restart" onClick={() => act(installUpdate)} />
  </> : status === 'failed' ? <>
    <Button label={t('@yovoice.update.openDownloads')} icon={<ArrowUpRight size={15} />} onClick={() => window.open(releaseUrl(null), '_blank')} />
    <Button label={t('@yovoice.update.retry')} variant="primary" onClick={() => act(checkForUpdate)} />
  </> : status === 'idle' || status === 'latest' ? <>
    <Button label={t('@yovoice.update.close')} onClick={close} />
    <Button label={t('@yovoice.update.check')} variant="primary" onClick={() => act(checkForUpdate)} />
  </> : <Button label={busy ? t('@yovoice.update.background') : t('@yovoice.update.close')} isDisabled={status === 'installing'} onClick={close} />;
  return <AppDialog title={title} width={560} busy={status === 'installing'} closeLabel={t('@yovoice.update.close')} error={error} onClose={close} actions={actions}>
    <VStack gap={4} data-testid="update-dialog">
      <small className="muted">{versionLine}{published && (fresh || status === 'latest') ? ` · ${t('@yovoice.update.published', { date: published })}` : ''}</small>
      {status === 'checking' ? <HStack gap={2} vAlign="center"><Spinner size="sm" aria-label={t('@yovoice.update.checking')} /><small>{t('@yovoice.update.checking')}</small></HStack> : null}
      {status === 'downloading' || status === 'verifying' ? <UpdateProgress update={update} /> : null}
      {status === 'ready' ? <p className="helper">{t('@yovoice.update.readyBody')}</p> : null}
      {status === 'installing' ? <HStack gap={2} vAlign="center"><Spinner size="sm" aria-label={t('@yovoice.update.installingTitle')} /><small>{t('@yovoice.update.installingBody')}</small></HStack> : null}
      {status === 'failed' ? <p className="dialog-error" role="alert">{update.error || t('@yovoice.update.failedBody')}</p> : null}
      {status === 'disabled' ? <p className="helper">{t('@yovoice.update.disabled')}</p> : null}
      {update.notes && update.version ? <VStack gap={2} className="release-notes-panel">
        <HStack hAlign="between" vAlign="center" gap={2}>
          <h4>{fresh ? t('@yovoice.update.whatsNew') : t('@yovoice.update.thisVersion')}</h4>
          <a className="release-link" href={releaseUrl(update.version)} target="_blank" rel="noreferrer">{t('@yovoice.update.fullNotes')}</a>
        </HStack>
        <ReleaseNotes body={update.notes} locale={locale} />
      </VStack> : null}
    </VStack>
  </AppDialog>;
}
