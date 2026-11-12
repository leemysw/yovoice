import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { HStack } from '@astryxdesign/core/Layout';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowUpRight } from 'lucide-react';
import { Selector } from '../../shared/selector';
import { AppDialog } from '../../shared/ui/app-dialog';
import { formatCallError, formatNotice } from '../../shared/i18n/format';
import { call } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import type { CommunityShare, CommunityState, Generation } from '../../shared/workbench';
import { CommunityLogin } from './community-login';

const communityTermsUrl = 'https://yovoice.leemysw.com/community/terms';

const stageLabel = { packing: '@yovoice.community.stagePacking', uploading: '@yovoice.community.stageUploading', submitting: '@yovoice.community.stageSubmitting' } as const;

// 把一首歌的某个版本分享到社区：先登录，再填标题和许可；上传在后台进行，关掉弹窗也不会中断。
export function ShareDialog({ generation, name, community, onClose }: { generation: Generation; name: string; community?: CommunityState; onClose: () => void }) {
  const t = useTranslator();
  const [title, setTitle] = useState(name);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [license, setLicense] = useState('noncommercial');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: unknown) => setError(noticeMessage(e));
  const share: CommunityShare | undefined = community?.share?.generationId === generation.id ? community.share : undefined;
  const dismiss = () => call('community.share.close').catch(fail);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await call('community.share', { generationId: generation.id, title: title.trim(), description: description.trim(), tags: tags.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean), license, acceptTerms: accepted });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const heading = t('@yovoice.community.share');
  if (share?.status === 'running') {
    const label = t(stageLabel[share.stage]);
    return <AppDialog title={heading} onClose={onClose} error={formatNotice(t, error)} actions={<Button label={t('@yovoice.action.cancel')} onClick={() => void dismiss()} />}>
      <ProgressBar label={label} value={share.received} max={share.total || 1} isIndeterminate={share.stage !== 'uploading'} />
    </AppDialog>;
  }
  if (share?.status === 'completed') {
    return <AppDialog title={heading} onClose={() => { void dismiss(); onClose(); }} actions={<Button variant="primary" label={t('@yovoice.action.close')} onClick={() => { void dismiss(); onClose(); }} />}>
      <Text role="status">{t('@yovoice.community.done')}</Text>
    </AppDialog>;
  }
  if (!community?.account) {
    return <AppDialog title={heading} subtitle={t('@yovoice.community.loginIntro')} error={formatNotice(t, error)} onClose={onClose}>
      <CommunityLogin community={community} onError={fail} />
    </AppDialog>;
  }
  // 上次失败或取消后回到表单，原因显示在下方；再点分享会开始新的一次。
  const last = share?.status === 'failed' ? formatCallError(t, share) : share?.status === 'cancelled' ? t('@yovoice.community.cancelled') : '';
  const ready = title.trim() !== '' && accepted && community.share?.status !== 'running';
  return <AppDialog title={heading} width={440} busy={busy} error={formatNotice(t, error) || last} onClose={onClose} actions={<Button label={t('@yovoice.community.submit')} variant="primary" isLoading={busy} isDisabled={!ready} onClick={() => void submit()} />}>
    <TextInput label={t('@yovoice.community.title')} value={title} onChange={value => setTitle(value.slice(0, 80))} />
    <TextArea label={t('@yovoice.community.description')} value={description} onChange={value => setDescription(value.slice(0, 2000))} rows={2} />
    <TextInput label={t('@yovoice.community.tags')} description={t('@yovoice.community.tagsHint')} value={tags} onChange={setTags} />
    <Selector label={t('@yovoice.community.license')} value={license} onChange={setLicense} description={license === 'open' ? t('@yovoice.community.licenseHint') : undefined}
      options={[{ value: 'noncommercial', label: t('@yovoice.community.licenseNoncommercial') }, { value: 'open', label: t('@yovoice.community.licenseOpen') }]} />
    <Text type="supporting" color="secondary">{t('@yovoice.community.contents')}</Text>
    <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
      <CheckboxInput label={t('@yovoice.community.terms')} value={accepted} onChange={setAccepted} />
      <Button size="sm" variant="ghost" label={t('@yovoice.community.termsLink')} icon={<ArrowUpRight size={15} />} onClick={() => window.open(communityTermsUrl, '_blank', 'noopener')} />
    </HStack>
  </AppDialog>;
}
