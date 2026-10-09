import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { AppDialog, ConfirmDelete } from '../../shared/ui/app-dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
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
    <Button label={t('@yovoice.media.reveal', { name: item.name })} isIconOnly icon={<FolderOpen size={15} />} size="sm" variant="ghost" onClick={() => { void call('media.reveal', { kind: item.kind, id: item.id }).catch(e => onError(noticeMessage(e))); }} />
    <Button label={t('@yovoice.media.delete', { noun, name: item.name })} isIconOnly icon={<Trash2 size={15} />} size="sm" variant="ghost" onClick={() => { setError(''); setAction('delete'); }} />
    {action === 'delete' ? <ConfirmDelete title={t('@yovoice.media.deleteTitle', { noun })}
      description={t('@yovoice.media.deleteBody', { name: item.name }) + t(item.kind === 'voices' ? '@yovoice.media.deleteVoiceExtra' : '@yovoice.media.deleteHistoryExtra')}
      confirmLabel={t('@yovoice.media.deleteConfirm', { noun })} busy={busy} error={error} onClose={() => setAction(null)} onConfirm={() => void submit()} /> : null}
    {action === 'rename' ? <AppDialog title={t('@yovoice.media.renameTitle', { noun })} busy={busy} error={error} onClose={() => setAction(null)} actions={<>
      <Button label={t('@yovoice.action.cancel')} isDisabled={busy} onClick={() => setAction(null)} />
      <Button label={t('@yovoice.media.saveName')} variant="primary" isLoading={busy} isDisabled={!name.trim() || name.trim().length > 120} onClick={() => void submit()} />
    </>}><TextInput label={t('@yovoice.media.name')} value={name} onChange={setName} /></AppDialog> : null}
  </HStack>;
}
