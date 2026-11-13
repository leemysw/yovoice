import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowRight, Download, Keyboard, Lock, RotateCcw, Search, Upload } from 'lucide-react';
import { call, saveText } from '../../shared/lib/client';
import { CallError } from '../../shared/lib/call-error';
import type { HotkeySettings as Settings, State } from '../../shared/workbench';
import { AppDialog } from '../../shared/ui/app-dialog';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';
import { hotkeyCommand, hotkeyCommands, hotkeyTree, type HotkeyCommand, type HotkeyNode } from '../../shared/hotkeys/commands';
import { activeBinding, bindingFor, bindingProblem, defaultBinding, findConflicts, openCheatsheet, platform, setHotkeyRecording } from '../../shared/hotkeys/hotkeys';
import { HotkeyKeys } from '../../shared/hotkeys/hotkey-keys';
import { bindingLabels, bindingText, eventKey, eventModifiers, normalizeBinding } from '../../shared/hotkeys/keys';
import { compactHotkeys, exportHotkeys, parseHotkeys, planImport, type HotkeyFile, type ImportMode } from '../../shared/hotkeys/transfer';

type Translate = ReturnType<typeof useTranslator>;
type Filter = 'all' | 'modified' | 'unset';
type Message = { text: string; replace?: { binding: string; others: string[] } };
interface Recording { id: string; mods: string[]; message?: Message }

const cmdName = (t: Translate, id: string) => t(`@yovoice.hotkeys.cmd.${id}` as `@yovoice.${string}`);
const cmdHint = (t: Translate, command: HotkeyCommand) => command.hint ? t(`@yovoice.hotkeys.hint.${command.id}` as `@yovoice.${string}`) : '';
const nodeName = (t: Translate, id: string) => t(`@yovoice.hotkeys.node.${id}` as `@yovoice.${string}`);
/** 命令所在的位置：功能区 › 页面 › 功能块。 */
export const commandPath = (t: Translate, command: HotkeyCommand) => [command.area, command.group, command.sub].filter((id): id is string => !!id).map(id => nodeName(t, id)).join(' › ');
const available = (command: HotkeyCommand) => !command.macOnly || platform === 'mac';
const nodeCommands = (node: HotkeyNode, commands: HotkeyCommand[]) => commands.filter(command => command.group === node.id || command.sub === node.id);
const text = (binding: string, range?: number) => binding.split('|').map(item => bindingText(item, platform, range)).join(' / ');

// 设置 › 快捷键：总开关、各功能区开关、按功能区三级分类的命令表；点按键即可录制新的组合键。
// active 为 false（切到了别的页面，设置页只是隐藏）时结束录制，免得在别处打字被当成录制的按键。
export function HotkeySettings({ state, run, active }: { state: State; run: (task: () => Promise<unknown>) => void; active: boolean }) {
  const t = useTranslator();
  const preferences = state.preferences;
  const settings = preferences.hotkeys;
  // 保存后到状态推送回来之前，接着的修改（例如连续拨两个开关）以刚保存的为准，不会盖掉前一次。
  const latest = useRef(settings);
  useEffect(() => { latest.current = settings; }, [settings]);
  const save = (next: Settings | undefined) => { latest.current = next; run(() => call('preferences.save', { ...preferences, hotkeys: next && compactHotkeys(next) })); };
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState<Recording | null>(null);
  const [dialog, setDialog] = useState<'export' | 'reset' | null>(null);
  const [imported, setImported] = useState<HotkeyFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const setBindings = (changes: Record<string, string | undefined>) => {
    const bindings = { ...latest.current?.bindings };
    for (const [id, binding] of Object.entries(changes)) {
      if (binding === undefined) delete bindings[id]; else bindings[id] = binding;
    }
    save({ ...latest.current, bindings });
  };
  const commit = (id: string, binding: string, others: string[] = []) => { setRecording(null); setBindings({ [id]: binding, ...Object.fromEntries(others.map(other => [other, ''])) }); };
  /** 检查一个按键：有问题时返回提示；与可替换的命令冲突时附带替换的做法。 */
  const check = (id: string, binding: string, current: Settings | undefined): Message | undefined => {
    const keys = text(binding, hotkeyCommand.get(id)?.range);
    const problem = bindingProblem(id, binding);
    if (problem === 'reserved') return { text: t('@yovoice.hotkeys.reserved', { keys }) };
    if (problem === 'modifier') return { text: t('@yovoice.hotkeys.needsModifier', { mods: platform === 'mac' ? '⌘ / ⌃ / ⌥' : 'Ctrl / Alt' }) };
    const conflicts = findConflicts(current, id, binding);
    if (!conflicts.length) return undefined;
    const fixed = conflicts.find(conflict => conflict.fixed);
    if (fixed) return { text: t('@yovoice.hotkeys.conflictFixed', { keys, name: cmdName(t, fixed.id) }) };
    const name = cmdName(t, conflicts[0].id);
    // 撞上几条命令时一并列出，替换时全部清除。
    return { text: conflicts.length > 1 ? t('@yovoice.hotkeys.conflictMany', { keys, name, count: conflicts.length }) : t('@yovoice.hotkeys.conflict', { keys, name }), replace: { binding, others: conflicts.map(conflict => conflict.id) } };
  };
  const reset = (id: string) => {
    const command = hotkeyCommand.get(id)!;
    const rest = { ...latest.current, bindings: Object.fromEntries(Object.entries(latest.current?.bindings ?? {}).filter(([key]) => key !== id)) };
    const message = check(id, defaultBinding(command), rest);
    if (message) setRecording({ id, mods: [], message });
    else setBindings({ [id]: undefined });
  };

  // 录制：在捕获阶段接住所有按键，不让页面和其他快捷键响应；Esc 取消，单按 ⌫ 清除。
  // Tab / Shift+Tab 结束录制并照常移动焦点；按着 Win 键或 AltGr 的组合不录。
  const onRecordKey = useEffectEvent((event: KeyboardEvent) => {
    if (!recording || recording.message?.replace || event.isComposing || event.keyCode === 229) return;
    if (event.type === 'keydown' && event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) { setRecording(null); return; }
    event.preventDefault();
    event.stopPropagation();
    const held = eventModifiers(event, platform);
    if (!held) return;
    const mods: string[] = held;
    const key = event.type === 'keydown' ? eventKey(event) : null;
    if (!key) { setRecording({ ...recording, mods }); return; }
    if (!mods.length && key === 'esc') { setRecording(null); return; }
    if (!mods.length && (key === 'backspace' || key === 'delete')) { commit(recording.id, ''); return; }
    const command = hotkeyCommand.get(recording.id)!;
    if (command.range && !/^[1-9]$/.test(key)) { setRecording({ ...recording, mods, message: { text: t('@yovoice.hotkeys.needsDigit') } }); return; }
    const binding = normalizeBinding([...mods, command.range ? '#' : key].join('+'), platform);
    const message = check(recording.id, binding, latest.current);
    if (message) setRecording({ ...recording, mods: [], message });
    else commit(recording.id, binding);
  });
  // 在录制的那一行之外按下鼠标（点了别处、切了页面）就结束录制。
  const onRecordPointer = useEffectEvent((event: PointerEvent) => {
    if (recording && !(event.target instanceof Element && event.target.closest(`[data-recording="true"]`))) setRecording(null);
  });
  const listening = !!recording && !recording.message?.replace;
  useEffect(() => {
    if (!listening) return;
    setHotkeyRecording(true);
    const stop = () => setRecording(null);
    const pointer = (event: PointerEvent) => onRecordPointer(event);
    window.addEventListener('keydown', onRecordKey, true);
    window.addEventListener('keyup', onRecordKey, true);
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('blur', stop);
    return () => {
      setHotkeyRecording(false);
      window.removeEventListener('keydown', onRecordKey, true);
      window.removeEventListener('keyup', onRecordKey, true);
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('blur', stop);
    };
  }, [listening]);
  useEffect(() => { if (!active) setRecording(null); }, [active]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => hotkeyCommands.filter(command => {
    if (!available(command)) return false;
    const binding = bindingFor(settings, command);
    if (filter === 'modified' && settings?.bindings?.[command.id] === undefined) return false;
    if (filter === 'unset' && (command.fixed || binding)) return false;
    if (!needle) return true;
    const labels = binding.split('|').map(item => bindingLabels(item, platform, command.range).join('')).join(' ');
    const haystack = [cmdName(t, command.id), cmdHint(t, command), commandPath(t, command), text(binding, command.range), labels].join(' ').toLowerCase();
    return haystack.includes(needle) || labels.toLowerCase().includes(needle.replace(/[\s+]/g, ''));
  }), [settings, filter, needle, t]);
  const expanded = !!needle || filter !== 'all';
  const toggleArea = (area: string, on: boolean) => {
    const off = (latest.current?.off ?? []).filter(item => item !== area);
    save({ ...latest.current, off: on ? off : [...off, area] });
  };
  const modifiedTotal = Object.keys(settings?.bindings ?? {}).length;

  const row = (command: HotkeyCommand) => {
    const binding = bindingFor(settings, command);
    const modified = settings?.bindings?.[command.id] !== undefined;
    const hint = cmdHint(t, command);
    const active = recording?.id === command.id;
    const name = cmdName(t, command.id);
    return <VStack key={command.id} className="hotkey-row" gap={1} data-testid={`hotkey-${command.id}`} data-modified={modified || undefined} data-fixed={command.fixed || undefined} data-recording={active || undefined}>
      <HStack hAlign="between" vAlign="center" gap={3}>
        <VStack className="hotkey-row-label" gap={0}>
          <p className="hotkey-row-name">{name}{command.macOnly ? <Token size="sm" label={t('@yovoice.hotkeys.macOnly')} /> : null}</p>
          {hint ? <small>{hint}</small> : null}
        </VStack>
        <HStack className="hotkey-row-control" gap={1} vAlign="center">
          {command.fixed ? <>
            <HotkeyKeys binding={binding} range={command.range} />
            <Lock className="hotkey-lock" size={14} role="img" aria-label={t('@yovoice.hotkeys.fixed')}><title>{t('@yovoice.hotkeys.fixed')}</title></Lock>
          </> : active && !recording.message?.replace ? <>
            <kbd className="hotkey-recorder" role="status" aria-live="polite">
              {recording.mods.length ? <HotkeyKeys binding={[...recording.mods, '…'].join('+')} /> : t('@yovoice.hotkeys.recording')}
            </kbd>
            <small className="hotkey-recorder-hint">{t('@yovoice.hotkeys.recordingHint')}</small>
            <Button size="sm" variant="ghost" label={t('@yovoice.action.cancel')} onClick={() => setRecording(null)} />
          </> : <>
            {modified ? <Button size="sm" variant="ghost" isIconOnly icon={<RotateCcw />} label={t('@yovoice.hotkeys.reset')} tooltip={t('@yovoice.hotkeys.resetTo', { keys: text(defaultBinding(command), command.range) || t('@yovoice.hotkeys.unset') })} onClick={() => reset(command.id)} /> : null}
            <Button className="hotkey-edit" size="sm" variant="ghost" label={t('@yovoice.hotkeys.edit', { name })} onClick={() => setRecording({ id: command.id, mods: [] })}>
              {binding ? <HotkeyKeys binding={binding} range={command.range} /> : <small className="hotkey-unset">{t('@yovoice.hotkeys.unset')}</small>}
            </Button>
          </>}
        </HStack>
      </HStack>
      {active && recording.message ? <HStack className="hotkey-message" gap={2} vAlign="center" wrap="wrap" role="alert">
        <small className="grow">{recording.message.text}</small>
        {recording.message.replace ? <>
          <Button size="sm" variant="primary" label={t('@yovoice.hotkeys.replace')} onClick={() => commit(command.id, recording.message!.replace!.binding, recording.message!.replace!.others)} />
          <Button size="sm" label={t('@yovoice.action.cancel')} onClick={() => setRecording(null)} />
        </> : null}
      </HStack> : null}
    </VStack>;
  };

  const group = (node: HotkeyNode, commands: HotkeyCommand[]) => {
    const own = nodeCommands(node, commands);
    if (!own.length) return null;
    return <Collapsible key={node.id} className="hotkey-group" chevronPosition="start" isOpen={expanded || !!open[node.id]} onOpenChange={value => setOpen(state => ({ ...state, [node.id]: value }))}
      trigger={<HStack className="hotkey-group-trigger" gap={2} vAlign="center"><strong>{nodeName(t, node.id)}</strong><small>{t('@yovoice.hotkeys.count', { count: own.length })}</small></HStack>}>
      <VStack className="hotkey-rows" gap={0}>
        {node.subs ? node.subs.map(sub => {
          const items = own.filter(command => command.sub === sub.id);
          return items.length ? <VStack key={sub.id} className="hotkey-sub" gap={0}><h5 className="hotkey-sub-title">{nodeName(t, sub.id)}</h5>{items.map(row)}</VStack> : null;
        }) : own.map(row)}
      </VStack>
    </Collapsible>;
  };

  return <VStack className="settings-panel hotkey-settings" gap={6} id="hotkeys-panel" role="tabpanel" aria-label={t('@yovoice.hotkeys.title')}>
    <SettingsGroup title={t('@yovoice.hotkeys.title')} description={activeBinding('global.cheatsheet') ? t('@yovoice.hotkeys.intro', { keys: text(activeBinding('global.cheatsheet')) }) : t('@yovoice.hotkeys.introNoKey')}
      actions={<HStack gap={2} wrap="wrap">
        <Button size="sm" variant="ghost" label={t('@yovoice.hotkeys.cheatsheet')} icon={<Keyboard size={15} />} onClick={openCheatsheet} />
        <Button size="sm" label={t('@yovoice.hotkeys.import')} icon={<Upload size={15} />} onClick={() => fileInput.current?.click()} />
        <Button size="sm" label={t('@yovoice.hotkeys.export')} icon={<Download size={15} />} onClick={() => setDialog('export')} />
        <Button size="sm" variant="ghost" label={t('@yovoice.hotkeys.resetAll')} isDisabled={!settings} onClick={() => setDialog('reset')} />
      </HStack>}>
      <SettingsRow label={t('@yovoice.hotkeys.enable')} hint={t('@yovoice.hotkeys.enableHint')}>
        <Switch data-testid="hotkeys-enabled" label={t('@yovoice.hotkeys.enable')} isLabelHidden value={!settings?.disabled} onChange={on => save({ ...latest.current, disabled: !on })} />
      </SettingsRow>
    </SettingsGroup>
    <input ref={fileInput} hidden type="file" accept=".json,application/json" aria-label={t('@yovoice.hotkeys.importFile')} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) run(async () => {
        const parsed = file.size <= 1024 * 1024 ? parseHotkeys(await file.text()) : null;
        if (!parsed) throw new CallError('@yovoice.hotkeys.importInvalid');
        setImported(parsed);
      });
    }} />
    <VStack className="hotkey-list" gap={3} data-disabled={settings?.disabled || undefined}>
      <HStack className="hotkey-toolbar" gap={3} vAlign="center" wrap="wrap">
        <TextInput size="sm" width="calc(var(--spacing-10) * 8)" label={t('@yovoice.hotkeys.search')} isLabelHidden placeholder={t('@yovoice.hotkeys.search')} startIcon={<Search size={15} />} hasClear value={query} onChange={setQuery} />
        <SegmentedControl size="sm" label={t('@yovoice.hotkeys.filter')} value={filter} onChange={value => setFilter(value as Filter)}>
          <SegmentedControlItem value="all" label={t('@yovoice.hotkeys.filterAll')} />
          <SegmentedControlItem value="modified" label={modifiedTotal ? `${t('@yovoice.hotkeys.filterModified')} ${modifiedTotal}` : t('@yovoice.hotkeys.filterModified')} />
          <SegmentedControlItem value="unset" label={t('@yovoice.hotkeys.filterUnset')} />
        </SegmentedControl>
      </HStack>
      {settings?.disabled ? <p className="hotkey-notice" role="status">{t('@yovoice.hotkeys.disabledNotice')}</p> : null}
      {visible.length ? hotkeyTree.map(area => {
        const commands = visible.filter(command => command.area === area.id);
        if (!commands.length) return null;
        const all = hotkeyCommands.filter(command => command.area === area.id && available(command));
        const modified = all.filter(command => settings?.bindings?.[command.id] !== undefined).length;
        const off = !!settings?.off?.includes(area.id);
        const name = nodeName(t, area.id);
        return <VStack key={area.id} className="hotkey-area" gap={0} data-testid={`hotkey-area-${area.id}`} data-off={off || undefined}>
          <Collapsible chevronPosition="start" isOpen={expanded || !!open[area.id]} onOpenChange={value => setOpen(state => ({ ...state, [area.id]: value }))}
            trigger={<VStack className="hotkey-area-trigger" gap={1}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <strong className="hotkey-area-title">{name}</strong>
                {modified ? <Token size="sm" color="orange" label={t('@yovoice.hotkeys.modifiedCount', { count: modified })} /> : null}
                {off ? <Token size="sm" label={t('@yovoice.hotkeys.areaOff')} /> : null}
              </HStack>
              <small>{[...area.groups.map(node => nodeName(t, node.id)), t('@yovoice.hotkeys.count', { count: all.length })].join(' · ')}</small>
            </VStack>}>
            <VStack className="hotkey-groups" gap={0}>{area.groups.map(node => group(node, commands))}</VStack>
          </Collapsible>
          <Switch className="hotkey-area-switch" size="sm" label={t('@yovoice.hotkeys.areaSwitch', { area: name })} isLabelHidden value={!off} onChange={on => toggleArea(area.id, on)} />
        </VStack>;
      }) : <p className="hotkey-notice">{t('@yovoice.hotkeys.empty')}</p>}
    </VStack>
    {dialog === 'export' ? <ExportDialog settings={settings} run={run} onClose={() => setDialog(null)} /> : null}
    {dialog === 'reset' ? <AppDialog title={t('@yovoice.hotkeys.resetAll')} onClose={() => setDialog(null)} actions={<>
      <Button label={t('@yovoice.action.cancel')} onClick={() => setDialog(null)} />
      <Button variant="destructive" label={t('@yovoice.hotkeys.resetAll')} onClick={() => { setDialog(null); save(undefined); }} />
    </>}><p className="helper">{t('@yovoice.hotkeys.resetAllConfirm')}</p></AppDialog> : null}
    {imported ? <ImportDialog file={imported} settings={settings} onClose={() => setImported(null)} onApply={next => { setImported(null); run(() => call('preferences.save', { ...preferences, hotkeys: next })); }} /> : null}
  </VStack>;
}

function ExportDialog({ settings, run, onClose }: { settings: Settings | undefined; run: (task: () => Promise<unknown>) => void; onClose: () => void }) {
  const t = useTranslator();
  const modified = Object.keys(settings?.bindings ?? {}).length;
  const [scope, setScope] = useState(modified ? 'modified' : 'all');
  const [switches, setSwitches] = useState(!!settings?.disabled || !!settings?.off?.length);
  const total = hotkeyCommands.filter(command => !command.fixed).length;
  return <AppDialog title={t('@yovoice.hotkeys.exportTitle')} width={460} onClose={onClose} actions={<>
    <Button label={t('@yovoice.action.cancel')} onClick={onClose} />
    <Button variant="primary" label={t('@yovoice.hotkeys.exportSave')} icon={<Download size={15} />} onClick={() => run(async () => {
      if (await saveText(exportHotkeys(settings, { all: scope === 'all', switches }), t('@yovoice.hotkeys.fileName'), 'json')) onClose();
    })} />
  </>}>
    <RadioList label={t('@yovoice.hotkeys.exportTitle')} isLabelHidden value={scope} onChange={setScope}>
      <RadioListItem value="modified" isDisabled={!modified} label={t('@yovoice.hotkeys.exportModified')} description={t('@yovoice.hotkeys.exportModifiedHint', { count: modified })} />
      <RadioListItem value="all" label={t('@yovoice.hotkeys.exportAll')} description={t('@yovoice.hotkeys.exportAllHint', { count: total })} />
    </RadioList>
    <CheckboxInput label={t('@yovoice.hotkeys.exportSwitches')} value={switches} onChange={setSwitches} />
  </AppDialog>;
}

function ImportDialog({ file, settings, onClose, onApply }: { file: HotkeyFile; settings: Settings | undefined; onClose: () => void; onApply: (next: Settings | undefined) => void }) {
  const t = useTranslator();
  const [mode, setMode] = useState<ImportMode>('merge');
  const plan = useMemo(() => planImport(settings, file, mode), [settings, file, mode]);
  const tag = (change: typeof plan.changes[number]) => change.reason === 'conflict' ? <Token size="sm" color="red" label={t('@yovoice.hotkeys.importConflict', { name: cmdName(t, change.by!) })} />
    : change.reason === 'reset' ? <Token size="sm" label={t('@yovoice.hotkeys.importReset')} />
      : change.overridden ? <Token size="sm" color="orange" label={t('@yovoice.hotkeys.importOverridden')} /> : null;
  const keys = (binding: string, range?: number) => binding ? <HotkeyKeys binding={binding} range={range} /> : <small className="hotkey-unset">{t('@yovoice.hotkeys.unset')}</small>;
  return <AppDialog title={t('@yovoice.hotkeys.importTitle')} width={560} subtitle={t('@yovoice.hotkeys.importSource', { platform: t(file.platform === 'mac' ? '@yovoice.hotkeys.platformMac' : '@yovoice.hotkeys.platformOther'), count: Object.keys(file.bindings).length })} onClose={onClose} actions={<>
    <Button label={t('@yovoice.action.cancel')} onClick={onClose} />
    <Button variant="primary" label={t('@yovoice.hotkeys.importApply')} isDisabled={!plan.changes.length && !plan.switchesChanged} onClick={() => onApply(plan.next)} />
  </>}>
    <VStack gap={1}>
      <SegmentedControl label={t('@yovoice.hotkeys.importTitle')} value={mode} onChange={value => setMode(value as ImportMode)} layout="fill">
        <SegmentedControlItem value="merge" label={t('@yovoice.hotkeys.importMerge')} />
        <SegmentedControlItem value="replace" label={t('@yovoice.hotkeys.importReplace')} />
      </SegmentedControl>
      <small className="muted">{t(mode === 'merge' ? '@yovoice.hotkeys.importMergeHint' : '@yovoice.hotkeys.importReplaceHint')}</small>
    </VStack>
    {plan.changes.length ? <VStack gap={2}>
      <strong>{t('@yovoice.hotkeys.importChanges', { count: plan.changes.length })}</strong>
      <VStack className="hotkey-import-list" gap={0} data-testid="hotkey-import-changes">
        {plan.changes.map(change => {
          const command = hotkeyCommand.get(change.id)!;
          return <HStack key={change.id} className="hotkey-import-row" gap={3} vAlign="center" hAlign="between" wrap="wrap">
            <VStack className="hotkey-row-label" gap={0}><p className="hotkey-row-name">{cmdName(t, change.id)}</p><small>{commandPath(t, command)}</small></VStack>
            <HStack gap={2} vAlign="center" wrap="wrap">{tag(change)}{keys(change.before, command.range)}<ArrowRight size={14} aria-hidden />{keys(change.after, command.range)}</HStack>
          </HStack>;
        })}
      </VStack>
    </VStack> : <p className="muted">{t('@yovoice.hotkeys.importNoChanges')}</p>}
    {plan.skipped.length ? <small className="muted">{t('@yovoice.hotkeys.importSkipped', { count: plan.skipped.length })}</small> : null}
    {plan.switchesChanged ? <small className="muted">{t('@yovoice.hotkeys.importSwitches')}</small> : null}
  </AppDialog>;
}
