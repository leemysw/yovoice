import { useState } from 'react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Player } from '../media/player';
import { call } from '../../shared/lib/client';
import { formatCallError, formatNotice } from '../../shared/i18n/format';
import type { Generation, Voice } from '../../shared/workbench';

export function VoiceEditor({ item, close }: { item: Generation | Voice; close: (saved?: boolean) => void }) {
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
  const invalid = !name.trim() ? '@yovoice.library.nameRequired' : name.length > 100 ? '@yovoice.voice.nameLimit' : text.length > 2000 ? '@yovoice.library.textLimit' : history && (item.duration < 1 || item.duration > 60) ? '@yovoice.voice.durationLimit' : '';
  if (confirmClose) return <AppDialog title={t('@yovoice.voice.unsaved')} busy={busy} onClose={() => setConfirmClose(false)} actions={<><Button label={t('@yovoice.library.continue')} onClick={() => setConfirmClose(false)} /><Button label={t('@yovoice.library.discard')} isDisabled={busy} onClick={() => close()} /><Button label={t('@yovoice.action.save')} isDisabled={!!invalid} isLoading={busy} onClick={() => void save()} /></>}>{error ? <p role="alert">{error}</p> : null}</AppDialog>;
  return <AppDialog title={t(history ? '@yovoice.voice.save' : '@yovoice.voice.edit')} width={560} busy={busy} onClose={requestClose} closeLabel={t('@yovoice.action.cancel')}
    error={formatNotice(t, error)}
    actions={<Button label={t('@yovoice.voice.saved')} variant="primary" isLoading={busy} isDisabled={!!invalid} onClick={() => void save()} />}>
    <Player compact suspended={false} track={{ id: item.id, name, fileName: item.fileName, kind: history ? 'outputs' : 'voices', subtitle: '' }} onError={setError} />
    <TextInput isRequired label={t('@yovoice.voice.name')} value={name} onChange={setName} />
    <TextArea label={t('@yovoice.voice.transcript')} value={text} onChange={setText} rows={4} description={`${text.length} / 2000`} />
    {invalid ? <p role="alert" className="dialog-error">{t(invalid)}</p> : null}
  </AppDialog>;
}
