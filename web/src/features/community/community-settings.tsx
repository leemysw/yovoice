import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Trash2 } from 'lucide-react';
import { call, parseCallError } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import { ConfirmDelete } from '../../shared/ui/app-dialog';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';
import type { CommunityItem, State } from '../../shared/workbench';
import { CommunityLogin } from './community-login';

const statusLabel = { draft: '@yovoice.community.statusDraft', pending: '@yovoice.community.statusPending', published: '@yovoice.community.statusPublished', rejected: '@yovoice.community.statusRejected', removed: '@yovoice.community.statusRemoved' } as const;

// 设置 › 通用里的“社区”：登录或退出账号，查看自己分享的作品和审核结果，并可从社区删除。
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
  return <SettingsGroup title={t('@yovoice.community.settings')}>
    <SettingsRow label={account ? account.nickname || account.email : t('@yovoice.community.account')} hint={account ? account.email : t('@yovoice.community.loginIntro')}>
      {account ? <Button size="sm" label={t('@yovoice.community.logout')} onClick={() => run(() => call('community.logout'))} />
        : <CommunityLogin size="sm" community={state.community} onError={e => run(() => Promise.reject(e))} />}
    </SettingsRow>
    {account && loadError ? <SettingsRow label={t('@yovoice.community.mine')} hint={formatCallError(t, parseCallError(loadError))} /> : null}
    {account && !loadError && items?.length === 0 ? <SettingsRow label={t('@yovoice.community.mine')} hint={t('@yovoice.community.mineEmpty')} /> : null}
    {account && !loadError ? items?.map(item => <SettingsRow key={item.id} label={item.title} hint={item.reviewNote && item.status !== 'published' ? `${t(statusLabel[item.status])} · ${item.reviewNote}` : t(statusLabel[item.status])}>
      {item.status === 'published' ? <Text type="supporting" color="secondary">{t('@yovoice.community.stats', { likes: item.likeCount, uses: item.useCount })}</Text> : null}
      <Button size="sm" variant="ghost" isIconOnly label={t('@yovoice.action.delete')} tooltip={t('@yovoice.action.delete')} icon={<Trash2 size={15} />} onClick={() => setDeleting(item)} />
    </SettingsRow>) : null}
    {deleting ? <ConfirmDelete title={t('@yovoice.community.deleteTitle')} description={t('@yovoice.community.deleteConfirm', { name: deleting.title })} confirmLabel={t('@yovoice.action.delete')} busy={busy} onClose={() => setDeleting(null)} onConfirm={() => void remove(deleting)} /> : null}
  </SettingsGroup>;
}
