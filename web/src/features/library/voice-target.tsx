import { useState } from 'react';
import { formatNotice } from '../../shared/i18n/format';
import { Button } from '@astryxdesign/core/Button';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { type Character, type Draft } from '../../shared/workbench';

// 应用声音必须明确作品和角色，不能改写隐藏的当前草稿。
export function VoiceTarget({ voice, drafts, initial, speakerId, apply, close }: {
  voice: Character; drafts: Draft[]; initial?: string; speakerId?: string;
  apply: (voice: Character, draftId: string, speakerId: string) => Promise<void>; close: () => void;
}) {
  const t = useTranslator();
  const [target, setTarget] = useState(initial ?? 'new');
  const [speaker, setSpeaker] = useState(speakerId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = drafts.find(d => d.id === target);
  const selected = draft?.subtitles?.speakers.find(s => s.id === speaker)?.id ?? draft?.subtitles?.speakers[0]?.id ?? '';
  return <AppDialog title={t('@yovoice.library.target')} subtitle={voice.name} busy={busy} error={formatNotice(t, error)} onClose={close} actions={<>
    <Button label={t('@yovoice.action.cancel')} isDisabled={busy} onClick={close} />
    <Button label={t('@yovoice.library.apply')} variant="primary" isLoading={busy} isDisabled={target !== 'new' && !draft} onClick={async () => {
      setBusy(true); setError('');
      try { await apply(voice, target, selected); close(); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }} />
  </>}>
    <Selector label={t('@yovoice.library.targetProject')} value={target} onChange={id => { setTarget(id); setSpeaker(''); }} options={[{ value: 'new', label: t('@yovoice.library.newText') }, ...drafts.map(d => ({ value: d.id, label: d.title }))]} />
    {draft?.subtitles ? <Selector label={t('@yovoice.library.targetSpeaker')} value={selected} onChange={setSpeaker} options={draft.subtitles.speakers.map((s, i) => ({ value: s.id, label: s.sourceName || t('@yovoice.subtitle.speaker', { n: i + 1 }) }))} /> : null}
  </AppDialog>;
}
