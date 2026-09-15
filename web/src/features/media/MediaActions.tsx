import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { call } from '../../shared/lib/client';
import type { Track } from '../../shared/workbench';

export function MediaActions({ item, beforeDelete, onError }: { item: Pick<Track, 'id' | 'kind' | 'name'>; beforeDelete: () => void; onError: (message: string) => void }) {
  const [action, setAction] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const noun = item.kind === 'voices' ? '声音' : '历史';
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'delete') beforeDelete();
      await call(action === 'rename' ? 'media.rename' : 'media.delete', { kind: item.kind, id: item.id, name: name.trim() });
      setAction(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <HStack className="media-actions" gap={1}>
    <Button label={`重命名${noun}${item.name}`} isIconOnly icon={<Pencil size={15} />} size="sm" variant="ghost" onClick={() => { setName(item.name); setError(''); setAction('rename'); }} />
    <Button label={`打开位置${item.name}`} isIconOnly icon={<FolderOpen size={15} />} size="sm" variant="ghost" onClick={() => { void call('media.reveal', { kind: item.kind, id: item.id }).catch(e => onError(e.message)); }} />
    <Button label={`删除${noun}${item.name}`} isIconOnly icon={<Trash2 size={15} />} size="sm" variant="ghost" onClick={() => { setError(''); setAction('delete'); }} />
    {action ? <Dialog isOpen onOpenChange={open => { if (!open && !busy) setAction(null); }} width={400} padding={6}><VStack gap={4}>
      <h2>{action === 'rename' ? `重命名${noun}` : `删除这条${noun}？`}</h2>
      {action === 'rename' ? <TextInput label="名称" value={name} onChange={setName} /> : <p className="helper">将删除“{item.name}”及其音频文件，无法撤销。{item.kind === 'voices' ? '使用此声音的作品需要重新选择音色，已生成的音频保留。' : '作品正文和参考音色保留。'}</p>}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <HStack hAlign="end" gap={2}><Button label="取消" size="sm" isDisabled={busy} onClick={() => setAction(null)} /><Button label={action === 'rename' ? '保存名称' : `删除${noun}`} size="sm" variant={action === 'rename' ? 'primary' : 'destructive'} isLoading={busy} isDisabled={action === 'rename' && (!name.trim() || name.trim().length > 120)} onClick={() => void submit()} /></HStack>
    </VStack></Dialog> : null}
  </HStack>;
}
