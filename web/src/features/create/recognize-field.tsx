import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ScanText } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import type { State } from '../../shared/workbench';

// 参考文本框加“识别文字”：用可选下载的语音识别模型把声音样本转成文字填进去。识别在后台运行，
// 结果经会话状态 transcript 回到发起识别的这个输入框，填入后清除；出错在框下方说明（不走全局通知）。
export function RecognizeField({ state, voiceId, apply, children }: {
  state: Pick<State, 'activity' | 'transcript'>; voiceId?: string | null;
  apply: (text: string) => void; children: ReactNode;
}) {
  const t = useTranslator();
  // pending 记下发起识别的样本和当时活动的开始时间，只认这次识别的结果与失败，不受之前的活动影响。
  const [pending, setPending] = useState<{ voiceId: string; since?: string | null } | null>(null);
  const [error, setError] = useState('');
  const activity = state.activity, transcript = state.transcript;
  useEffect(() => {
    if (!pending || !transcript || transcript.voiceId !== pending.voiceId) return;
    setPending(null);
    apply(transcript.text);
    void call('transcript.dismiss', { id: transcript.id }).catch(() => undefined);
  }, [pending, transcript, apply]);
  useEffect(() => {
    if (!pending || activity?.task !== 'recognize' || activity.startedAt === pending.since || (activity.status !== 'failed' && activity.status !== 'cancelled')) return;
    setPending(null);
    if (activity.status === 'failed') setError(formatCallError(t, activity));
  }, [pending, activity, t]);
  // 换了声音样本，上一次的提示不再相关。
  useEffect(() => { setError(''); }, [voiceId]);
  async function recognize() {
    if (!voiceId) return;
    setError('');
    setPending({ voiceId, since: activity?.startedAt });
    try { await call('voice.recognize', { id: voiceId }); }
    catch (e) { setPending(null); setError(formatCallError(t, e)); }
  }
  const working = !!pending;
  // 推理引擎一次只做一件事：生成或其他任务进行中时不能识别。
  const busy = activity?.status === 'running' && !working;
  return <VStack gap={2}>
    {children}
    <HStack gap={2} vAlign="center">
      <Button size="sm" variant="secondary" icon={<ScanText />} label={t(working ? '@yovoice.recognize.working' : '@yovoice.recognize.action')}
        tooltip={t(voiceId ? '@yovoice.recognize.hint' : '@yovoice.recognize.needVoice')} isLoading={working} isDisabled={!voiceId || busy} onClick={() => void recognize()} />
    </HStack>
    {error ? <small role="alert" className="dialog-error">{error}</small> : null}
  </VStack>;
}
