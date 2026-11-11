import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowUpRight } from 'lucide-react';
import { call } from '../../shared/lib/client';
import type { CommunityLogin as Login, CommunityState } from '../../shared/workbench';

// 社区登录：点一下在浏览器里打开确认页，应用里只显示要核对的确认码，用户确认后状态里出现账号。
export function CommunityLogin({ community, onError, size = 'md' }: { community?: CommunityState; onError: (error: unknown) => void; size?: 'sm' | 'md' }) {
  const t = useTranslator();
  const [starting, setStarting] = useState(false);
  const login = community?.login;
  const start = async () => {
    setStarting(true);
    try {
      const next = await call<Login>('community.login');
      window.open(next.url, '_blank', 'noopener');
    } catch (e) { onError(e); } finally { setStarting(false); }
  };
  if (!login || login.expired) {
    return <VStack gap={2} hAlign="start">
      {login?.expired ? <Text type="supporting" color="secondary">{t('@yovoice.community.loginExpired')}</Text> : null}
      <Button size={size} variant="primary" label={t('@yovoice.community.login')} icon={<ArrowUpRight size={15} />} isLoading={starting} onClick={() => void start()} />
    </VStack>;
  }
  return <VStack gap={2} hAlign="start">
    <Text type="supporting" color="secondary" role="status">{t('@yovoice.community.loginCode', { code: login.code })}</Text>
    <HStack gap={2}>
      <Button size="sm" label={t('@yovoice.community.loginReopen')} icon={<ArrowUpRight size={15} />} onClick={() => window.open(login.url, '_blank', 'noopener')} />
      <Button size="sm" variant="ghost" label={t('@yovoice.action.cancel')} onClick={() => { void call('community.login.cancel').catch(onError); }} />
    </HStack>
  </VStack>;
}
