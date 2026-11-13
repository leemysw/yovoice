import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { call, parseCallError } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import { ConfirmDelete } from '../../shared/ui/app-dialog';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';
import type { CommunityItem, State } from '../../shared/workbench';
import { LibraryEmpty } from '../library/library-layout';
import { RecordCover } from '../library/record-cover';
import { CommunityLogin } from './community-login';

const communityUrl = 'https://yovoice.leemysw.com/community';

const statusLabel = { draft: '@yovoice.community.statusDraft', pending: '@yovoice.community.statusPending', published: '@yovoice.community.statusPublished', rejected: '@yovoice.community.statusRejected', removed: '@yovoice.community.statusRemoved' } as const;
// 审核时选的预设原因以 preset:<名称> 返回，按界面语言显示；审核员自己写的原因原样显示。
const noteLabel = { 'preset:voice': '@yovoice.community.note.voice', 'preset:copyright': '@yovoice.community.note.copyright', 'preset:mismatch': '@yovoice.community.note.mismatch', 'preset:quality': '@yovoice.community.note.quality' } as const;

// 设置 › 社区：未登录时是一张空唱片和登录入口；登录后显示账号、自己分享的作品和审核结果，并可从社区删除。
export function CommunitySettings({ state, run }: { state: State; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const account = state.community?.account;
  const finished = state.community?.share?.status === 'completed' ? state.community.share.id : '';
  const [items, setItems] = useState<CommunityItem[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState<CommunityItem | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = !!account;
  // 登录后以及每次分享完成后重新读取列表。
  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    void call<CommunityItem[]>('community.mine').then(next => { if (current) { setItems(next); setLoadError(null); } }).catch(e => { if (current) setLoadError(e); });
    return () => { current = false; };
  }, [signedIn, finished]);
  const remove = async (item: CommunityItem) => {
    setBusy(true);
    try {
      await call('community.delete', { id: item.id });
      setItems(list => list?.filter(other => other.id !== item.id) ?? null); setDeleting(null);
    } catch (e) { setLoadError(e); setDeleting(null); } finally { setBusy(false); }
  };
  const browse = <Button size="sm" variant="ghost" label={t('@yovoice.community.browse')} icon={<ArrowUpRight size={15} />} onClick={() => window.open(communityUrl, '_blank', 'noopener')} />;
  if (!account) {
    return <VStack className="settings-panel community-empty empty-state" gap={0} hAlign="center" id="community-panel" role="tabpanel" aria-label={t('@yovoice.community.settings')}>
      <LibraryEmpty art={<RecordCover seed="community" title={t('@yovoice.community.settings')} />} title={t('@yovoice.community.emptyTitle')} description={t('@yovoice.community.emptyBody')}
        action={<VStack gap={3} hAlign="center"><CommunityLogin align="center" community={state.community} onError={e => run(() => Promise.reject(e))} />{browse}</VStack>} />
    </VStack>;
  }
  return <VStack className="settings-panel" gap={6} id="community-panel" role="tabpanel" aria-label={t('@yovoice.community.settings')}><SettingsGroup title={t('@yovoice.community.account')}>
    <SettingsRow label={account.nickname || account.email} hint={account.nickname ? account.email : undefined}>
      {browse}
      <Button size="sm" label={t('@yovoice.community.logout')} onClick={() => run(() => call('community.logout'))} />
    </SettingsRow>
  </SettingsGroup>
  <SettingsGroup title={t('@yovoice.community.mine')}>
    {items === null && !loadError ? <SettingsRow label={t('@yovoice.app.loading')} /> : null}
    {account && loadError ? <SettingsRow label={formatCallError(t, parseCallError(loadError))} /> : null}
    {account && !loadError && items?.length === 0 ? <SettingsRow label={t('@yovoice.community.mineEmpty')} /> : null}
    {account && !loadError ? items?.map(item => <SettingsRow key={item.id} label={item.title} hint={item.reviewNote && item.status !== 'published' ? `${t(statusLabel[item.status])} · ${item.reviewNote in noteLabel ? t(noteLabel[item.reviewNote as keyof typeof noteLabel]) : item.reviewNote}` : t(statusLabel[item.status])}>
      {item.status === 'published' ? <Text type="supporting" color="secondary">{t('@yovoice.community.stats', { likes: item.likeCount, uses: item.useCount })}</Text> : null}
      <Button size="sm" variant="ghost" isIconOnly label={t('@yovoice.action.delete')} tooltip={t('@yovoice.action.delete')} icon={<Trash2 size={15} />} onClick={() => setDeleting(item)} />
    </SettingsRow>) : null}
    {deleting ? <ConfirmDelete title={t('@yovoice.community.deleteTitle')} description={t('@yovoice.community.deleteConfirm', { name: deleting.title })} confirmLabel={t('@yovoice.action.delete')} busy={busy} onClose={() => setDeleting(null)} onConfirm={() => void remove(deleting)} /> : null}
  </SettingsGroup></VStack>;
}
