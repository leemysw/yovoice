import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import { AppDialog } from '../../shared/ui/app-dialog';
import { call, saveText } from '../../shared/lib/client';
import { formatCallError, formatNotice } from '../../shared/i18n/format';
import { noticeMessage } from '../../shared/lib/call-error';
import type { Generation, State } from '../../shared/workbench';
import { captionsToSrt, captionsToVtt, spokenText, wordCaptions, type Caption } from './caption-export';

export type CaptionFormat = 'srt' | 'vtt';

// 字幕导出的公共部分：名称、格式与保存。转写页和语音版本的导出对话框共用。
export async function saveCaptions(captions: Caption[], name: string, format: CaptionFormat) {
  return saveText((format === 'srt' ? captionsToSrt : captionsToVtt)(captions), name, format);
}

// 语音版本导出字幕：正文已知，用对齐模型算出逐字时间（结果存在版本上，下次直接用），再按句分行导出 SRT / WebVTT。
// 还没对齐时点导出先在后台对齐，完成后自动保存；出错在对话框里说明，不走全局通知。
export function CaptionDialog({ state, generation, name: initialName, onClose }: {
  state: Pick<State, 'activity' | 'history'>; generation: Generation; name: string; onClose: () => void;
}) {
  const t = useTranslator();
  const [name, setName] = useState(initialName);
  const [format, setFormat] = useState<CaptionFormat>('srt');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // pending 记下发起对齐时活动的开始时间，只认这次对齐的结果与失败。
  const [pending, setPending] = useState<{ since?: string | null } | null>(null);
  const live = state.history.find(item => item.id === generation.id) ?? generation;
  const words = live.textWords;
  const activity = state.activity;
  const save = async () => {
    if (!words?.length) return;
    const captions = wordCaptions(spokenText(live.settings.text), words);
    if (!captions.length) { setError('@yovoice.caption.empty'); return; }
    setSaving(true); setError('');
    try { if (await saveCaptions(captions, name.trim(), format)) onClose(); }
    catch (e) { setError(noticeMessage(e)); }
    finally { setSaving(false); }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!pending) return;
    if (words?.length) { setPending(null); void saveRef.current(); return; }
    if (activity?.task !== 'caption' || activity.startedAt === pending.since || (activity.status !== 'failed' && activity.status !== 'cancelled')) return;
    setPending(null);
    if (activity.status === 'failed') setError(formatCallError(t, activity));
  }, [pending, words, activity, t]);
  const align = async () => {
    setError('');
    setPending({ since: activity?.startedAt });
    try { await call('generation.alignText', { id: generation.id }); }
    catch (e) { setPending(null); setError(formatCallError(t, e)); }
  };
  const working = !!pending || saving;
  // 推理引擎一次只做一件事：其他任务进行中时不能对齐。
  const busy = !words?.length && activity?.status === 'running' && !pending;
  return <AppDialog title={t('@yovoice.caption.title')} busy={working} error={formatNotice(t, error)} onClose={onClose} actions={<>
    <Button label={t('@yovoice.action.cancel')} onClick={onClose} />
    <Button label={t(pending ? '@yovoice.caption.aligning' : '@yovoice.caption.export')} variant="primary" isLoading={working} isDisabled={!name.trim() || busy}
      onClick={() => void (words?.length ? save() : align())} />
  </>}>
    <TextInput label={t('@yovoice.timeline.exportName')} value={name} onChange={setName} />
    <Selector label={t('@yovoice.timeline.exportType')} value={format} onChange={value => setFormat(value as CaptionFormat)} options={[{ value: 'srt', label: t('@yovoice.timeline.formatSrt') }, { value: 'vtt', label: t('@yovoice.timeline.formatVtt') }]} />
    <small>{t(words?.length ? '@yovoice.caption.ready' : busy ? '@yovoice.caption.busy' : '@yovoice.caption.alignHint')}</small>
  </AppDialog>;
}
