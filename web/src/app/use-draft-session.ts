import { useEffect, useRef, useState } from 'react';
import { call } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { createDraft, type Draft, type State } from '../shared/workbench';
import { writeLocal } from '../shared/lib/local-store';

const unknownPrefix = '@yovoice.error.unknown::';

// 当前作品的编辑会话：自动保存、显式保存与删除共用一条保存链，保证写入顺序。
export function useDraftSession(ready: boolean, state: State, onError: (message: string) => void) {
  const [draft, setDraft] = useState<Draft>(() => createDraft(true));
  // 未保存过的新作品在用户首次编辑前不写入后端。
  const [draftPersisted, setDraftPersisted] = useState(true);
  // 只有作品编辑页（含其版本记录）处于打开状态；设置、我的声音和作品列表等页面不存在“当前作品”，
  // 离开时立即保存未落盘的修改并关闭会话，原生宿主退出时也就无需补存作品。
  const [active, setActive] = useState(false);
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

  // window.__workbenchDraft 只在作品打开且存在未落盘的修改时有值：原生宿主退出或迁移前据此补存最后的输入，
  // 已保存或作品未打开时为空，避免在设置页等没有改动的场景下退出也去写作品（数据目录不可写时会挡住退出）。
  useEffect(() => {
    if (!ready || deleting || !draftPersisted || !active) return;
    window.__workbenchDraft = draft;
    writeLocal('yovoice-active-project', draft.id);
    setSaving(true); setSaveFailed(false); const sequence = ++saveSequence.current;
    const timer = saveTimer.current = setTimeout(() => {
      pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', draft));
      void pendingSave.current.then(() => { if (sequence === saveSequence.current) { setSaving(false); if (window.__workbenchDraft === draft) window.__workbenchDraft = undefined; } }).catch(e => { setSaveFailed(true); setSaving(false); onError(noticeMessage(e)); });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, ready, deleting, draftPersisted, active, onError]);

  // 离开编辑页：防抖中的自动保存已被取消，这里把尚未落盘的修改立即写入后关闭会话。
  useEffect(() => {
    if (active || !ready) return;
    const pending = window.__workbenchDraft;
    window.__workbenchDraft = undefined;
    if (!pending) { setSaving(false); return; }
    const sequence = ++saveSequence.current;
    pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', pending));
    void pendingSave.current.then(() => { if (sequence === saveSequence.current) setSaving(false); }).catch(e => {
      // 保存失败时保留待保存内容，退出时宿主仍会补存或提供备份。
      window.__workbenchDraft ??= pending; setSaveFailed(true); setSaving(false); onError(noticeMessage(e));
    });
  }, [active, ready, onError]);

  const change = (patch: Partial<Draft>) => { setDraftPersisted(true); setDraft(current => ({ ...current, ...patch })); };

  // 取消待执行的自动保存，排在已发出的保存之后立即写入。
  async function persistDraft(next: Draft) {
    clearTimeout(saveTimer.current); const sequence = ++saveSequence.current;
    setSaving(true); setSaveFailed(false);
    pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', next));
    try { await pendingSave.current; setDraftPersisted(true); if (sequence === saveSequence.current) { setSaving(false); window.__workbenchDraft = undefined; } }
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
        // 替换作品要么在下面立即保存，要么是尚未写入的空白新作品，退出时都无需补存。
        window.__workbenchDraft = undefined; setDraft(replacement); setDraftPersisted(!!next);
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
    draft, setDraft, draftPersisted, setDraftPersisted, saving, saveFailed, change, persistDraft, setActive,
    deleteTarget, setDeleteTarget, deleting, deleteError, deleteDraft,
  };
}

export type DraftSession = ReturnType<typeof useDraftSession>;
