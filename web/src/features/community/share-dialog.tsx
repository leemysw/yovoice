import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { HStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import { AppDialog } from '../../shared/ui/app-dialog';
import { formatCallError, formatNotice } from '../../shared/i18n/format';
import { call } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import type { CommunityShare, CommunityState, Generation } from '../../shared/workbench';
import { splitTags } from '../music/music-draft';
import { CommunityLogin } from './community-login';
import { sharedLyrics } from './share-lyrics';

const communityTermsUrl = 'https://yovoice.leemysw.com/community/terms';

// 社区接受的标签：每个最多 24 个字、不含特殊字符，最多 8 个；和服务端的限制一致。
const maxTags = 8;
const shareableTag = (tag: string) => [...tag].length <= 24 && !/["\\%_<>&]/.test(tag);

// 生成时用的风格标签里挑出能直接当社区标签的短标签，作为默认值，用户还可以改。
export function defaultShareTags(style: string) {
  const seen = new Set<string>();
  return splitTags(style).filter(tag => {
    const key = tag.toLowerCase();
    if (!shareableTag(tag) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxTags).join(', ');
}

const stageLabel = { packing: '@yovoice.community.stagePacking', uploading: '@yovoice.community.stageUploading', submitting: '@yovoice.community.stageSubmitting' } as const;

// 把一首歌的某个版本分享到社区：先登录，再填标题和许可；上传在后台进行，关掉弹窗也不会中断。
export function ShareDialog({ generation, name, community, onClose }: { generation: Generation; name: string; community?: CommunityState; onClose: () => void }) {
  const t = useTranslator();
  const [title, setTitle] = useState(name);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState(() => defaultShareTags(generation.settings.text));
  const [license, setLicense] = useState('noncommercial');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: unknown) => setError(noticeMessage(e));
  // 对齐过的歌词随歌曲分享，社区页按它滚动显示；没对齐时提醒先去对齐。
  const lyrics = sharedLyrics(generation);
  const share: CommunityShare | undefined = community?.share?.generationId === generation.id ? community.share : undefined;
  const dismiss = () => call('community.share.close').catch(fail);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await call('community.share', { generationId: generation.id, title: title.trim(), description: description.trim(), tags: tags.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean), license, acceptTerms: accepted, lyrics: lyrics.state === 'aligned' ? lyrics.lines : [] });
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
  // 勾选说明里的“社区条款”本身就是链接，不再另放一个按钮；点链接以外的文字照常勾选。
  const termsText = t('@yovoice.community.terms');
  const termsLink = t('@yovoice.community.termsLink');
  const termsAt = termsText.indexOf(termsLink);
  const [termsBefore, termsAfter] = termsAt < 0 ? [`${termsText} `, ''] : [termsText.slice(0, termsAt), termsText.slice(termsAt + termsLink.length)];
  const ready = title.trim() !== '' && accepted && community.share?.status !== 'running';
  return <AppDialog title={heading} width={440} busy={busy} error={formatNotice(t, error) || last} onClose={onClose} actions={<Button label={t('@yovoice.community.submit')} variant="primary" isLoading={busy} isDisabled={!ready} onClick={() => void submit()} />}>
    <TextInput label={t('@yovoice.community.title')} value={title} onChange={value => setTitle(value.slice(0, 80))} />
    <TextArea label={t('@yovoice.community.description')} value={description} onChange={value => setDescription(value.slice(0, 2000))} rows={2} />
    <TextInput label={t('@yovoice.community.tags')} description={t('@yovoice.community.tagsHint')} value={tags} onChange={setTags} />
    <Selector label={t('@yovoice.community.license')} value={license} onChange={setLicense} description={license === 'open' ? t('@yovoice.community.licenseHint') : undefined}
      options={[{ value: 'noncommercial', label: t('@yovoice.community.licenseNoncommercial') }, { value: 'open', label: t('@yovoice.community.licenseOpen') }]} />
    <Text type="supporting" color="secondary">{t('@yovoice.community.contents')}</Text>
    {lyrics.state === 'unaligned' ? <Text type="supporting" color="secondary" role="note">{t('@yovoice.community.lyricsUnaligned')}</Text> : null}
    <HStack gap={3} vAlign="center">
      <CheckboxInput label={termsText} isLabelHidden value={accepted} onChange={setAccepted} />
      <Text color="secondary" onClick={() => setAccepted(value => !value)}>{termsBefore}<Link href={communityTermsUrl} isExternalLink onClick={event => event.stopPropagation()}>{termsLink}</Link>{termsAfter}</Text>
    </HStack>
  </AppDialog>;
}
