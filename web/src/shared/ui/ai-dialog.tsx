import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { LoaderCircle, Settings2 } from 'lucide-react';
import { AppDialog } from './app-dialog';
import { call } from '../lib/client';
import { formatCallError } from '../i18n/format';
import { formatTime, type State } from '../workbench';

// AI 生成对话框：写下需求后调用当前 AI 服务；未配置服务时引导到“设置 › AI”。请求进行中可取消。
export function AIDialog({ title, hint, placeholder, submitLabel, state, initial = '', children, submit, configure, close }: {
  title: string; hint: string; placeholder: string; submitLabel: string; state: State; initial?: string; children?: ReactNode;
  submit: (brief: string) => Promise<void>; configure: () => void; close: () => void;
}) {
  const t = useTranslator();
  const [brief, setBrief] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const cancelled = useRef(false);
  const provider = state.aiProviders?.find(p => p.id === state.aiProviderID);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => { clearInterval(timer); setElapsed(0); };
  }, [busy]);
  async function run() {
    setBusy(true); setError(''); cancelled.current = false;
    try { await submit(brief.trim()); close(); }
    // 用户取消时请求以取消错误结束，不再提示。
    catch (e) { if (!cancelled.current) setError(formatCallError(t, e)); }
    finally { setBusy(false); }
  }
  if (!provider?.model) return <AppDialog title={title} onClose={close} closeLabel={t('@yovoice.action.cancel')} actions={<>
    <Button label={t('@yovoice.action.cancel')} onClick={close} />
    <Button label={t('@yovoice.ai.configure')} variant="primary" icon={<Settings2 />} onClick={() => { close(); configure(); }} />
  </>}>
    <p>{t('@yovoice.ai.notConfigured')}</p>
  </AppDialog>;
  return <AppDialog title={title} subtitle={hint} width={520} busy={busy} error={error} onClose={close} closeLabel={t('@yovoice.action.cancel')} actions={busy ? <>
    <HStack className="grow" gap={2} vAlign="center"><LoaderCircle size={14} className="generation-spinner" aria-hidden /><small role="status">{t('@yovoice.ai.working', { model: provider.model, time: formatTime(elapsed) })}</small></HStack>
    <Button label={t('@yovoice.action.cancel')} onClick={() => { cancelled.current = true; void call('ai.cancel'); }} />
  </> : <>
    <Button label={t('@yovoice.action.cancel')} onClick={close} />
    <Button label={submitLabel} variant="primary" isDisabled={!brief.trim()} onClick={() => void run()} />
  </>}>
    <VStack gap={3}>
      <TextArea label={t('@yovoice.ai.brief')} value={brief} rows={4} maxLength={2000} placeholder={placeholder} isDisabled={busy} onChange={value => setBrief(value.slice(0, 2000))} />
      {children}
      <small className="muted">{t('@yovoice.ai.via', { name: provider.name, model: provider.model })}</small>
    </VStack>
  </AppDialog>;
}
