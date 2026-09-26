import { X } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout, LayoutHeader, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Player } from '../media/Player';
import { call } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import type { Generation, Voice } from '../../shared/workbench';

export function VoiceEditor({ item, close }: { item: Generation | Voice; close: (saved?: boolean) => void }) {
  const t = useTranslator();
  const history = 'settings' in item;
  const [name, setName] = useState(history ? item.title : item.name);
  const [text, setText] = useState(history ? item.settings.text : item.referenceText ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await call(history ? 'voice.fromGeneration' : 'voice.update', { id: item.id, name, referenceText: text }); close(true); }
    catch (e) { setError(formatCallError(t, e)); } finally { setBusy(false); }
  }
  const invalid = !name.trim() ? '@yovoice.library.nameRequired' : name.length > 100 ? '@yovoice.voice.nameLimit' : text.length > 2000 ? '@yovoice.library.textLimit' : history && (item.duration < 1 || item.duration > 60) ? '@yovoice.voice.durationLimit' : '';
  return <Dialog isOpen purpose="form" width={560} padding={0} onOpenChange={open => { if (!open && !busy) close(); }}><Layout padding={6} header={<LayoutHeader paddingBlockEnd={4}>
    <HStack gap={3} vAlign="center" hAlign="between"><h2 tabIndex={-1} data-autofocus="">{t(history ? '@yovoice.voice.save' : '@yovoice.voice.edit')}</h2><Button label={t('@yovoice.action.cancel')} isIconOnly variant="ghost" icon={<X size={18} />} isDisabled={busy} onClick={() => close()} /></HStack></LayoutHeader>} content={<LayoutContent><VStack gap={4}>
    <Player compact suspended={false} track={{ id: item.id, name, fileName: item.fileName, kind: history ? 'outputs' : 'voices', subtitle: '' }} onError={setError} />
    <TextInput isRequired label={t('@yovoice.voice.name')} value={name} onChange={setName} />
    <TextArea label={t('@yovoice.voice.transcript')} value={text} onChange={setText} rows={4} description={`${text.length} / 2000`} />
    </VStack></LayoutContent>} footer={<LayoutFooter><VStack gap={3} paddingBlockStart={6}>
    {invalid ? <p role="alert" className="dialog-error">{t(invalid)}</p> : null}
    {error ? <p role="alert">{error.startsWith('@yovoice.') ? t(error) : error}</p> : null}
    <HStack className="dialog-actions" gap={2} hAlign="end"><Button label={t('@yovoice.voice.saved')} variant="primary" isLoading={busy} isDisabled={busy || !!invalid} onClick={() => void save()} /></HStack>
  </VStack></LayoutFooter>} /></Dialog>;
}
