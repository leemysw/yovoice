import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import type { Track } from '../../shared/workbench';

export function MediaActions({ item, beforeDelete, onError, onEdit }: { onEdit?: () => void; item: Pick<Track, 'id' | 'kind' | 'name'>; beforeDelete: () => void; onError: (message: string) => void }) {
  const t = useTranslator();
  const [action, setAction] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const noun = item.kind === 'voices' ? t('@yovoice.media.nounVoice') : t('@yovoice.media.nounHistory');
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'delete') beforeDelete();
      await call(action === 'rename' ? 'media.rename' : 'media.delete', { kind: item.kind, id: item.id, name: name.trim() });
      setAction(null);
    } catch (e) { setError(formatCallError(t, e)); }
    finally { setBusy(false); }
  }
  return <HStack className="media-actions" gap={1}>
    <Button label={onEdit ? t('@yovoice.voice.edit') : t('@yovoice.media.rename', { noun, name: item.name })} isIconOnly icon={<Pencil size={15} />} size="sm" variant="ghost" onClick={() => { if (onEdit) { onEdit(); return; } setName(item.name); setError(''); setAction('rename'); }} />
    <Button label={t('@yovoice.media.reveal', { name: item.name })} isIconOnly icon={<FolderOpen size={15} />} size="sm" variant="ghost" onClick={() => { void call('media.reveal', { kind: item.kind, id: item.id }).catch(e => onError(e.message)); }} />
    <Button label={t('@yovoice.media.delete', { noun, name: item.name })} isIconOnly icon={<Trash2 size={15} />} size="sm" variant="ghost" onClick={() => { setError(''); setAction('delete'); }} />
    {action ? <Dialog isOpen onOpenChange={open => { if (!open && !busy) setAction(null); }} width={400} padding={6}><VStack gap={4}>
      <h2 tabIndex={-1} data-autofocus="">{action === 'rename' ? t('@yovoice.media.renameTitle', { noun }) : t('@yovoice.media.deleteTitle', { noun })}</h2>
      {action === 'rename' ? <TextInput label={t('@yovoice.media.name')} value={name} onChange={setName} /> : <p className="helper">{t('@yovoice.media.deleteBody', { name: item.name })}{item.kind === 'voices' ? t('@yovoice.media.deleteVoiceExtra') : t('@yovoice.media.deleteHistoryExtra')}</p>}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <HStack className="dialog-actions" hAlign="end" gap={2}><Button label={t('@yovoice.action.cancel')} isDisabled={busy} onClick={() => setAction(null)} /><Button label={action === 'rename' ? t('@yovoice.media.saveName') : t('@yovoice.media.deleteConfirm', { noun })} variant={action === 'rename' ? 'primary' : 'destructive'} isLoading={busy} isDisabled={action === 'rename' && (!name.trim() || name.trim().length > 120)} onClick={() => void submit()} /></HStack>
    </VStack></Dialog> : null}
  </HStack>;
}
