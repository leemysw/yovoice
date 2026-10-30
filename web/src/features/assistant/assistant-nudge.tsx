import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import { X } from 'lucide-react';
import { AssistantAvatar } from './assistant-avatar';
import type { Nudge } from './use-assistant-nudge';

/** 右下角的提示气泡：Ocho 形象、一句话、一个动作与关闭。launcher 为入口仍在时，气泡停在入口上方。 */
export function AssistantNudge({ nudge, launcher, onAct, onClose }: { nudge: Nudge; launcher: boolean; onAct: (nudge: Nudge) => void; onClose: () => void }) {
  const t = useTranslator();
  return <HStack className="assistant-nudge" data-testid="assistant-nudge" data-tone={nudge.tone} data-launcher={launcher || undefined} gap={2} vAlign="start" role="status">
    <AssistantAvatar working={false} size={24} />
    <VStack className="grow" gap={2}>
      <Text type="inherit" color="inherit" className="assistant-nudge-text">{nudge.text}</Text>
      <HStack gap={2}><Button size="sm" variant="primary" label={nudge.action} onClick={() => onAct(nudge)} /></HStack>
    </VStack>
    <Button size="sm" variant="ghost" isIconOnly icon={<X size={13} />} label={t('@yovoice.assistant.nudge.close')} onClick={onClose} />
  </HStack>;
}
