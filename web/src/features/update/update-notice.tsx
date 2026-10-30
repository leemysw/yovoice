import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowDownToLine, PartyPopper, RefreshCw, X } from 'lucide-react';
import { formatCallError } from '../../shared/i18n/format';
import { installUpdate, showUpdateDialog, updatePending, updatePercent, useAppUpdate } from './app-update';

// 全局提示：发现新版本、更新已就绪、刚完成更新各提示一次，关闭后本次启动不再出现。重启安装的请求失败时在提示里说明。
export function UpdateNotice() {
  const t = useTranslator();
  const update = useAppUpdate();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [error, setError] = useState('');
  if (!update) return null;
  const key = update.status === 'ready' ? `ready:${update.version}`
    : update.status === 'downloading' || update.status === 'verifying' ? `found:${update.version}`
      : update.updatedFrom && (update.status === 'latest' || update.status === 'idle' || update.status === 'checking') ? `updated:${update.current}` : '';
  if (!key || dismissed.includes(key)) return null;
  const dismiss = () => setDismissed(current => [...current, key]);
  const percent = updatePercent(update);
  const ready = update.status === 'ready';
  const updated = key.startsWith('updated:');
  const message = ready ? t('@yovoice.update.noticeReady', { version: update.version ?? '' })
    : updated ? t('@yovoice.update.noticeUpdated', { version: update.current })
      : t('@yovoice.update.noticeFound', { version: update.version ?? '' });
  return <HStack className="notice update-notice" data-status={ready ? 'ready' : updated ? 'updated' : 'found'} role="status" gap={3} vAlign="center" data-testid="update-notice">
    {ready ? <RefreshCw size={16} aria-hidden /> : updated ? <PartyPopper size={16} aria-hidden /> : <ArrowDownToLine size={16} aria-hidden />}
    <VStack className="grow" gap={1}>
      <p>{message}</p>
      {!ready && !updated ? <ProgressBar label={message} isLabelHidden value={percent ?? 0} isIndeterminate={percent === null || update.status === 'verifying'} /> : null}
      {error ? <small className="dialog-error" role="alert">{error}</small> : null}
    </VStack>
    {updated && !update.notes ? null : <Button size="sm" variant={ready ? 'ghost' : 'secondary'} label={t('@yovoice.update.viewNotes')} onClick={showUpdateDialog} />}
    {ready ? <Button size="sm" variant="primary" label={t('@yovoice.update.restart')} onClick={() => { setError(''); installUpdate().catch((e: unknown) => setError(formatCallError(t, e))); }} /> : null}
    <Button label={t('@yovoice.action.closeNotice')} size="sm" variant="ghost" isIconOnly icon={<X size={16} />} onClick={dismiss} />
  </HStack>;
}

// 侧栏底部的常驻入口：下载中显示进度，就绪后提供重启更新，直到安装完成。
export function UpdateSidebarCard() {
  const t = useTranslator();
  const update = useAppUpdate();
  const [error, setError] = useState('');
  if (!update || !updatePending(update)) return null;
  const percent = updatePercent(update);
  const ready = update.status === 'ready' || update.status === 'installing';
  return <VStack className="sidebar-update" gap={2} data-testid="sidebar-update">
    <Button variant="ghost" size="sm" className="sidebar-update-title" label={ready ? t('@yovoice.update.sidebarReady', { version: update.version ?? '' }) : t('@yovoice.update.sidebarDownloading', { version: update.version ?? '' })}
      icon={ready ? <RefreshCw size={15} /> : <ArrowDownToLine size={15} />} onClick={showUpdateDialog} />
    {ready ? <Button size="sm" variant="primary" width="100%" label={t('@yovoice.update.restart')} isLoading={update.status === 'installing'} onClick={() => { setError(''); installUpdate().catch((e: unknown) => setError(formatCallError(t, e))); }} />
      : <ProgressBar label={t('@yovoice.update.sidebarDownloading', { version: update.version ?? '' })} isLabelHidden value={percent ?? 0} isIndeterminate={percent === null || update.status === 'verifying'} />}
    {error ? <small className="dialog-error" role="alert">{error}</small> : null}
  </VStack>;
}
