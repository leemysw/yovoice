import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useClipboard } from '@astryxdesign/core/hooks';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { call, parseCallError } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import type { LocalAPIStatus } from '../../shared/workbench';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';

// 设置 › 通用里的“本机接口”：在 127.0.0.1 上开放 HTTP / MCP 接口，供本机其他软件调用语音生成。
export function LocalAPISettings({ run }: { run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const [status, setStatus] = useState<LocalAPIStatus | null>(null);
  // 读取失败时保留分组并显示原因与重试，而不是让整组设置悄悄消失。
  const [loadError, setLoadError] = useState<unknown>(null);
  const [port, setPort] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const { copy, isCopied } = useClipboard({ announce: t('@yovoice.settings.localApiCopied') });
  const apply = (next: LocalAPIStatus) => { setStatus(next); setPort(String(next.port)); };
  const load = () => call<LocalAPIStatus>('localApi.get').then(next => { setStatus(next); setPort(String(next.port)); setLoadError(null); }).catch(setLoadError);
  useEffect(() => { void call<LocalAPIStatus>('localApi.get').then(next => { setStatus(next); setPort(String(next.port)); }).catch(setLoadError); }, []);
  if (!status) {
    return loadError ? <SettingsGroup title={t('@yovoice.settings.localApi')}>
      <SettingsRow label={t('@yovoice.settings.localApiEnabled')} hint={formatCallError(t, parseCallError(loadError))}>
        <Button size="sm" label={t('@yovoice.app.pageError.retry')} icon={<RefreshCw size={16} />} onClick={() => { void load(); }} />
      </SettingsRow>
    </SettingsGroup> : null;
  }
  const save = (method: string, data: unknown = {}) => {
    setSaving(true);
    const task = (pending.current ?? Promise.resolve()).catch(() => {}).then(async () => {
      try { apply(await call<LocalAPIStatus>(method, data)); }
      catch (error) { setPort(String(status.port)); throw error; }
    });
    pending.current = task;
    run(async () => {
      try { await task; }
      finally {
        if (pending.current === task) {
          pending.current = null;
          setSaving(false);
          setToggling(false);
        }
      }
    });
  };
  const savePort = () => { if (!pending.current && port.trim() !== String(status.port)) save('localApi.save', { enabled: status.enabled, port: Number(port.trim()) }); };
  const address = `http://127.0.0.1:${status.port}`;
  const hint = status.error ? formatCallError(t, parseCallError(status.error))
    : status.running ? t('@yovoice.settings.localApiRunning', { url: status.url ?? address }) : t('@yovoice.settings.localApiOff');
  return <SettingsGroup title={t('@yovoice.settings.localApi')} description={t('@yovoice.settings.localApiIntro')}>
    <SettingsRow label={t('@yovoice.settings.localApiEnabled')} hint={<Text type="inherit" color="inherit" data-testid="local-api-status" data-running={String(status.running)}>{hint}</Text>}>
      {status.running ? <StatusDot variant="success" label={t('@yovoice.settings.localApiRunningShort')} /> : status.error ? <StatusDot variant="error" label={t('@yovoice.settings.localApiFailed')} /> : null}
      <Switch label={t('@yovoice.settings.localApiEnabled')} isLabelHidden value={status.enabled} isLoading={toggling} isDisabled={toggling} onChange={enabled => { setToggling(true); save('localApi.save', { enabled, port: Number(port.trim()) }); }} />
    </SettingsRow>
    <SettingsRow label={t('@yovoice.settings.localApiPort')} hint={t('@yovoice.settings.localApiPortHint')}>
      <TextInput size="sm" label={t('@yovoice.settings.localApiPort')} isLabelHidden value={port} onChange={value => setPort(value.replace(/\D/g, '').slice(0, 5))}
        onBlur={savePort} onEnter={savePort} isDisabled={saving} width="calc(var(--spacing-10) * 2)" />
    </SettingsRow>
    <SettingsRow label={t('@yovoice.settings.localApiToken')} hint={t('@yovoice.settings.localApiTokenHint')}>
      <TextInput size="sm" type="password" label={t('@yovoice.settings.localApiToken')} isLabelHidden isReadOnly value={status.token} width="calc(var(--spacing-10) * 5)" />
      <Button size="sm" label={isCopied ? t('@yovoice.settings.localApiCopied') : t('@yovoice.settings.localApiCopy')} icon={isCopied ? <Check size={15} /> : <Copy size={15} />} onClick={() => void copy(status.token)} />
      <Button size="sm" variant="ghost" label={t('@yovoice.settings.localApiReset')} icon={<RefreshCw size={15} />} isDisabled={saving} onClick={() => save('localApi.resetToken')} />
    </SettingsRow>
    <SettingsRow className="local-api-example" label={t('@yovoice.settings.localApiExample')} hint={t('@yovoice.settings.localApiExampleHint', { url: address })}>
      <CodeBlock size="sm" language="bash" hasLanguageLabel={false} width="100%" code={`curl -H "Authorization: Bearer YOUR_TOKEN" ${address}/v1/status`} />
    </SettingsRow>
  </SettingsGroup>;
}
