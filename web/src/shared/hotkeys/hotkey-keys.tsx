import { Fragment } from 'react';
import { useTranslator } from '@astryxdesign/core/i18n';
import { platform } from './hotkeys';
import { bindingLabels } from './keys';

// 按键徽标：每个键一个 <kbd>，整组再包一层 <kbd>（HTML 里嵌套的 kbd 表示组合键）；| 分隔的几组之间写“或”。
// Astryx 的 Kbd 在所有平台都把 alt、shift 画成 ⌥⇧，这里按平台显示，所以自己画。
export function HotkeyKeys({ binding, range, className = '' }: { binding: string; range?: number; className?: string }) {
  const t = useTranslator();
  const combos = binding.split('|').filter(Boolean);
  return <kbd className={`hotkey-keys ${className}`} data-platform={platform}>
    {combos.map((combo, index) => <Fragment key={combo}>
      {index ? <small className="hotkey-keys-or">{t('@yovoice.hotkeys.or')}</small> : null}
      <kbd className="hotkey-combo">{bindingLabels(combo, platform, range).map((label, key) => <kbd key={key} className="hotkey-key">{label}</kbd>)}</kbd>
    </Fragment>)}
  </kbd>;
}
