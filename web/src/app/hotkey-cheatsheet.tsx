import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Settings2 } from 'lucide-react';
import { AppDialog } from '../shared/ui/app-dialog';
import { hotkeyCommands, hotkeyTree, type HotkeyCommand } from '../shared/hotkeys/commands';
import { activeBinding, bindingFor, platform, useHotkey, useRegisteredHotkeys } from '../shared/hotkeys/hotkeys';
import { HotkeyKeys } from '../shared/hotkeys/hotkey-keys';

// 快捷键速查（默认 ⌘/ / Ctrl+/）：只列出此刻有组件注册、能用的命令，按功能区与页面分组；
// 同一块里的固定按键（拆行、合并、撤销等）一并列出。设置页的“快捷键速查”按钮也能打开，快捷键关闭时同样可用。
export function HotkeyCheatsheet({ page, disabled, customize }: { page: string; disabled: boolean; customize: () => void }) {
  const t = useTranslator();
  const [open, setOpen] = useState(false);
  useHotkey('global.cheatsheet', () => setOpen(value => !value), { dialog: true });
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('workbench-open-cheatsheet', show);
    return () => window.removeEventListener('workbench-open-cheatsheet', show);
  }, []);
  const registered = useRegisteredHotkeys();
  if (!open) return null;
  const blockOf = (command: HotkeyCommand) => command.sub ?? command.group;
  const blocks = new Set(hotkeyCommands.filter(command => registered.has(command.id) && activeBinding(command.id)).map(blockOf));
  const shown = hotkeyCommands.filter(command => blocks.has(blockOf(command)) && (!command.macOnly || platform === 'mac')
    && (command.fixed || (registered.has(command.id) && activeBinding(command.id))));
  const close = () => setOpen(false);
  return <AppDialog title={t('@yovoice.hotkeys.cheatsheet')} width={720} onClose={close} actions={<Button label={t('@yovoice.hotkeys.cheatsheetSettings')} icon={<Settings2 size={15} />} onClick={() => { close(); customize(); }} />}>
    {disabled ? <p className="muted">{t('@yovoice.hotkeys.cheatsheetOff')}</p> : !shown.length ? <p className="muted">{t('@yovoice.hotkeys.cheatsheetEmpty')}</p>
      : <VStack className="hotkey-cheatsheet" gap={5} data-page={page} data-testid="hotkey-cheatsheet">
        {hotkeyTree.map(area => {
          const items = shown.filter(command => command.area === area.id);
          if (!items.length) return null;
          return <VStack key={area.id} gap={2}>
            <h4>{t(`@yovoice.hotkeys.node.${area.id}` as `@yovoice.${string}`)}</h4>
            <VStack className="hotkey-cheatsheet-grid" gap={0}>
              {[...new Set(items.map(blockOf))].map(block => <VStack key={block} className="hotkey-cheatsheet-block" gap={1}>
                <small className="hotkey-cheatsheet-title">{t(`@yovoice.hotkeys.node.${block}` as `@yovoice.${string}`)}</small>
                {items.filter(command => blockOf(command) === block).map(command => <HStack key={command.id} className="hotkey-cheatsheet-row" hAlign="between" vAlign="center" gap={3}>
                  <p>{t(`@yovoice.hotkeys.cmd.${command.id}` as `@yovoice.${string}`)}</p>
                  <HotkeyKeys binding={command.fixed ? bindingFor(undefined, command) : activeBinding(command.id)} range={command.range} />
                </HStack>)}
              </VStack>)}
            </VStack>
          </VStack>;
        })}
      </VStack>}
  </AppDialog>;
}
