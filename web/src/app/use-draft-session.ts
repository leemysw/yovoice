import { useEffect, useRef, useState } from 'react';
import { call } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { createDraft, withCueIds, type Draft, type State } from '../shared/workbench';

const unknownPrefix = '@yovoice.error.unknown::';

// 当前作品的编辑会话：自动保存、显式保存与删除共用一条保存链，保证写入顺序。
export function useDraftSession(ready: boolean, state: State, onError: (message: string) => void) {
  const [draft, setDraft] = useState<Draft>(() => createDraft(true));
  // 未保存过的新作品在用户首次编辑前不写入后端。
  const [draftPersisted, setDraftPersisted] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  useEffect(() => setDeleteError(''), [deleteTarget?.id]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  // 只有最后一次保存完成时才清除“保存中”。
  const saveSequence = useRef(0);

  useEffect(() => {
    if (!ready || deleting || !draftPersisted) return;
    window.__workbenchDraft = draft;
    localStorage.setItem('yovoice-active-project', draft.id);
    setSaving(true); setSaveFailed(false); const sequence = ++saveSequence.current;
    const timer = saveTimer.current = setTimeout(() => {
      pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', draft));
      void pendingSave.current.then(() => { if (sequence === saveSequence.current) setSaving(false); }).catch(e => { setSaveFailed(true); setSaving(false); onError(noticeMessage(e)); });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, ready, deleting, draftPersisted, onError]);

  const change = (patch: Partial<Draft>) => { setDraftPersisted(true); setDraft(current => withCueIds({ ...current, ...patch })); };

  // 取消待执行的自动保存，排在已发出的保存之后立即写入。
  async function persistDraft(next: Draft) {
    clearTimeout(saveTimer.current); const sequence = ++saveSequence.current;
    setSaving(true); setSaveFailed(false);
    pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', next));
    try { await pendingSave.current; setDraftPersisted(true); if (sequence === saveSequence.current) setSaving(false); }
    catch (error) { setSaving(false); setSaveFailed(true); throw error; }
  }

  async function deleteDraft() {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError(''); clearTimeout(saveTimer.current); ++saveSequence.current;
    try {
      // 等待已发出的保存，再切换当前作品，避免删除后被延迟保存恢复。
      await pendingSave.current.catch(() => {});
      if (deleteTarget.id === draft.id) {
        const next = state.drafts.find(item => item.id !== draft.id);
        const replacement = next ?? createDraft(false, state.preferences.uiLocale, state.models[0]?.id ?? 'index-2.5-q8');
        window.__workbenchDraft = replacement; setDraft(replacement); setDraftPersisted(!!next);
        if (next) await call('draft.save', next);
      }
      await call('draft.delete', { id: deleteTarget.id });
      setDeleteTarget(null);
    } catch (error) {
      // 删除对话框只显示原因本身。
      const message = noticeMessage(error);
      setDeleteError(message.startsWith(unknownPrefix) ? message.slice(unknownPrefix.length) : message);
    }
    finally { setDeleting(false); }
  }

  return {
    draft, setDraft, draftPersisted, setDraftPersisted, saving, saveFailed, change, persistDraft,
    deleteTarget, setDeleteTarget, deleting, deleteError, deleteDraft,
  };
}

export type DraftSession = ReturnType<typeof useDraftSession>;
