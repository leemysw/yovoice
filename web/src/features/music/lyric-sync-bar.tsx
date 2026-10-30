import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowDown } from 'lucide-react';

// 逐行校准条：显示操作提示与已标记的行数，可以撤销上一行、取消校准，或把下一行标记为从当前播放位置开始。
// ready 为假（音频还没加载）时不能标记。
export function LyricSyncBar({ done, total, ready, undo, cancel, mark }: { done: number; total: number; ready: boolean; undo: () => void; cancel: () => void; mark: () => void }) {
  const t = useTranslator();
  return <HStack className="now-playing-sync" gap={3} vAlign="center" wrap="wrap" role="group" aria-label={t('@yovoice.music.syncLyrics')}>
    <small className="now-playing-sync-hint">{t('@yovoice.music.syncHint')}</small>
    <small className="now-playing-sync-count">{t('@yovoice.music.syncProgress', { done, total })}</small>
    <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.syncUndo')} isDisabled={!done} onClick={undo} />
    <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.syncCancel')} onClick={cancel} />
    <Button className="now-playing-mark" size="sm" variant="ghost" icon={<ArrowDown />} label={t('@yovoice.music.syncNext')} isDisabled={!ready} onClick={mark} />
  </HStack>;
}
