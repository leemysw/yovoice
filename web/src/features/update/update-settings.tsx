import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { formatDateTime } from '../../shared/i18n/format';
import { RefreshCw, Star } from 'lucide-react';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';
import { formatCallError } from '../../shared/i18n/format';
import { checkForUpdate, installUpdate, projectUrl, showUpdateDialog, useAppUpdate } from './app-update';
import { UpdateProgress } from './update-dialog';

// 设置 › 通用里的“版本与更新”：当前版本、检查状态、下载进度和更新内容入口。检查或安装请求失败时原因显示在状态下方。
export function UpdateSettings() {
  const t = useTranslator();
  const locale = useLocale();
  const update = useAppUpdate();
  const [error, setError] = useState('');
  const act = (job: () => Promise<unknown>) => { setError(''); job().catch((e: unknown) => setError(formatCallError(t, e))); };
  // 引导到 GitHub 点 Star，用默认浏览器打开项目主页；没有更新服务（浏览器预览）时也显示。
  const star = <SettingsRow label={t('@yovoice.update.starTitle')} hint={t('@yovoice.update.starHint')}>
    <Button size="sm" icon={<Star size={15} />} label={t('@yovoice.update.star')} onClick={() => window.open(projectUrl, '_blank')} />
  </SettingsRow>;
  if (!update) return <SettingsGroup title={t('@yovoice.update.group')}>{star}</SettingsGroup>;
  const { status } = update;
  const checked = update.checkedAt ? formatDateTime(update.checkedAt, locale, 'day') : '';
  const hint = status === 'checking' ? t('@yovoice.update.checking')
    : status === 'downloading' || status === 'verifying' ? t('@yovoice.update.foundTitle', { version: update.version ?? '' })
      : status === 'ready' ? t('@yovoice.update.readyTitle', { version: update.version ?? '' })
        : status === 'installing' ? t('@yovoice.update.installingTitle')
          : status === 'failed' ? update.error || t('@yovoice.update.failedBody')
            : status === 'latest' ? t('@yovoice.update.latestHint', { time: checked })
              : status === 'disabled' ? t('@yovoice.update.disabled') : t('@yovoice.update.autoHint');
  const hasNotes = !!update.notes && !!update.version;
  return <SettingsGroup title={t('@yovoice.update.group')}>
    <SettingsRow label={t('@yovoice.update.currentVersion', { version: update.current })} hint={<><Text type="inherit" color="inherit" data-testid="update-status" data-status={status}>{hint}</Text>{error ? <Text type="inherit" color="inherit" className="dialog-error" role="alert">{error}</Text> : null}</>}>
      {hasNotes ? <Button size="sm" variant="ghost" label={t('@yovoice.update.viewNotes')} onClick={showUpdateDialog} /> : null}
      {status === 'ready' || status === 'installing' ? <Button size="sm" variant="primary" label={t('@yovoice.update.restart')} isLoading={status === 'installing'} onClick={() => act(installUpdate)} />
        : status !== 'disabled' ? <Button size="sm" icon={<RefreshCw size={15} />} label={t('@yovoice.update.check')} isLoading={status === 'checking'} isDisabled={status === 'downloading' || status === 'verifying'} onClick={() => act(checkForUpdate)} /> : null}
    </SettingsRow>
    {status === 'downloading' || status === 'verifying' ? <SettingsRow className="update-progress-row" label={t('@yovoice.update.progress')}><UpdateProgress update={update} /></SettingsRow> : null}
    {star}
  </SettingsGroup>;
}
