import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu, type DropdownMenuItemData } from '@astryxdesign/core/DropdownMenu';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import type { Transcript } from '../../shared/workbench';
import { AppDialog, ConfirmDelete } from '../../shared/ui/app-dialog';

// 一份转写的更多操作：重命名与删除，列表与编辑页共用；extra 放在前面，如编辑页的复制全文。
// beforeDelete 在删除前调用，编辑页借此丢掉还没保存的改动。
export function TranscriptMenu({ transcript, extra = [], beforeDelete, onDeleted }: {
  transcript: Transcript; extra?: DropdownMenuItemData[]; beforeDelete?: () => void; onDeleted?: () => void;
}) {
  const t = useTranslator();
  const [action, setAction] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = transcript.name || t('@yovoice.transcribe.defaultName');
  const openDialog = (next: 'rename' | 'delete') => { setName(transcript.name ?? ''); setError(''); setAction(next); };
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'delete') { beforeDelete?.(); await call('transcript.delete', { id: transcript.id }); setAction(null); onDeleted?.(); }
      else { await call('transcript.rename', { id: transcript.id, name: name.trim() }); setAction(null); }
    } catch (e) { setError(formatCallError(t, e)); }
    finally { setBusy(false); }
  }
  return <>
    <DropdownMenu presentation="popover" alignment="end" menuWidth="calc(var(--spacing-10) * 4)" hasChevron={false}
      button={{ label: t('@yovoice.transcribe.more', { name: title }), icon: <MoreHorizontal />, isIconOnly: true, variant: 'ghost', size: 'sm' }}
      items={[
        ...extra,
        { id: 'rename', label: t('@yovoice.transcribe.rename'), icon: <Pencil className="project-menu-icon" strokeWidth={1.5} />, onClick: () => openDialog('rename') },
        { id: 'delete', label: t('@yovoice.transcribe.delete'), icon: <Trash2 className="project-menu-icon" strokeWidth={1.5} />, variant: 'destructive', onClick: () => openDialog('delete') },
      ]} />
    {action === 'delete' ? <ConfirmDelete title={t('@yovoice.transcribe.deleteTitle', { name: title })} description={t('@yovoice.transcribe.deleteBody')}
      confirmLabel={t('@yovoice.transcribe.delete')} busy={busy} error={error} onClose={() => setAction(null)} onConfirm={() => void submit()} /> : null}
    {action === 'rename' ? <AppDialog title={t('@yovoice.transcribe.renameTitle')} busy={busy} error={error} onClose={() => setAction(null)} actions={<>
      <Button label={t('@yovoice.action.cancel')} isDisabled={busy} onClick={() => setAction(null)} />
      <Button label={t('@yovoice.media.saveName')} variant="primary" isLoading={busy} isDisabled={!name.trim() || name.trim().length > 120} onClick={() => void submit()} />
    </>}><TextInput label={t('@yovoice.transcribe.name')} value={name} onChange={setName} /></AppDialog> : null}
  </>;
}
