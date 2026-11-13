import { useRef, useState } from 'react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Player } from '../media/player';
import { call } from '../../shared/lib/client';
import { formatCallError, formatNotice } from '../../shared/i18n/format';
import { RecognizeField } from '../create/recognize-field';
import type { Generation, State, Voice } from '../../shared/workbench';
import { useHotkey, useHotkeyAria, useHotkeyText, withHotkey } from '../../shared/hotkeys/hotkeys';

export function VoiceEditor({ item, state, close }: { item: Generation | Voice; state: Pick<State, 'activity' | 'transcript'>; close: (saved?: boolean) => void }) {
  const t = useTranslator();
  const history = 'settings' in item;
  const [name, setName] = useState(history ? item.title : item.name);
  const [text, setText] = useState(history ? item.settings.text : item.referenceText ?? '');
  const [confirmClose, setConfirmClose] = useState(false);
  const changed = name !== (history ? item.title : item.name) || text !== (history ? item.settings.text : item.referenceText ?? '');
  const requestClose = () => { if (changed) setConfirmClose(true); else close(); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await call(history ? 'voice.fromGeneration' : 'voice.update', { id: item.id, name, referenceText: text }); close(true); }
    catch (e) { setError(formatCallError(t, e)); } finally { setBusy(false); }
  }
  // 编辑框本身是对话框：保存键只在焦点位于这个对话框里时响应，被别的对话框（如速查浮层）盖住时不响应；“未保存”确认框里同样可以直接保存。
  const dialog = useRef<HTMLDialogElement>(null);
  const saveKeys = useHotkeyText('refs.save'), saveAria = useHotkeyAria('refs.save');
  const invalid = !name.trim() ? '@yovoice.library.nameRequired' : name.length > 100 ? '@yovoice.voice.nameLimit' : text.length > 2000 ? '@yovoice.library.textLimit' : history && (item.duration < 1 || item.duration > 60) ? '@yovoice.voice.durationLimit' : '';
  useHotkey('refs.save', () => void save(), { enabled: !busy && !invalid, within: dialog });
  const saveTip = (label: string) => withHotkey(label, saveKeys, undefined);
  if (confirmClose) return <AppDialog dialogRef={dialog} title={t('@yovoice.voice.unsaved')} busy={busy} onClose={() => setConfirmClose(false)} actions={<><Button label={t('@yovoice.library.continue')} onClick={() => setConfirmClose(false)} /><Button label={t('@yovoice.library.discard')} isDisabled={busy} onClick={() => close()} /><Button label={t('@yovoice.action.save')} tooltip={saveTip(t('@yovoice.action.save'))} aria-keyshortcuts={saveAria} isDisabled={!!invalid} isLoading={busy} onClick={() => void save()} /></>}>{error ? <p role="alert">{error}</p> : null}</AppDialog>;
  return <AppDialog dialogRef={dialog} title={t(history ? '@yovoice.voice.save' : '@yovoice.voice.edit')} width={560} busy={busy} onClose={requestClose} closeLabel={t('@yovoice.action.cancel')}
    error={formatNotice(t, error)}
    actions={<Button label={t('@yovoice.voice.saved')} tooltip={saveTip(t('@yovoice.voice.saved'))} aria-keyshortcuts={saveAria} variant="primary" isLoading={busy} isDisabled={!!invalid} onClick={() => void save()} />}>
    <Player compact suspended={false} track={{ id: item.id, name, fileName: item.fileName, kind: history ? 'outputs' : 'voices', subtitle: '' }} onError={setError} />
    <TextInput isRequired label={t('@yovoice.voice.name')} value={name} onChange={setName} />
    {/* 生成版本自带台词作原文；导入或录制的样本可以用语音识别填入。 */}
    {history ? <TextArea label={t('@yovoice.voice.transcript')} value={text} onChange={setText} rows={4} description={`${text.length} / 2000`} />
      : <RecognizeField state={state} voiceId={item.id} apply={setText}>
        <TextArea label={t('@yovoice.voice.transcript')} value={text} onChange={setText} rows={4} description={`${text.length} / 2000`} />
      </RecognizeField>}
    {invalid ? <p role="alert" className="dialog-error">{t(invalid)}</p> : null}
  </AppDialog>;
}
