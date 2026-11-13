import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Switch } from '@astryxdesign/core/Switch';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ChevronRight } from 'lucide-react';
import { Selector } from '../../shared/selector';
import { call } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatNotice } from '../../shared/i18n/format';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';
import { EngineStatus } from '../../shared/ui/engine-status';
import type { EngineSettings, ModelPackage, State } from '../../shared/workbench';
import definitions from '@internal/catalog/runtime_options.json';

type Value = string | number | boolean;
type Option = { key: string; type: string; default?: Value; min?: number; max?: number; step?: number; values?: string[] };
const options = definitions as Record<string, Option[]>;

// 同一模型族的各个模型名称取共同的开头（如 IndexTTS 2 与 2.5 → IndexTTS 2），作为会话参数的模型名。
function familyName(catalog: ModelPackage[], family: string) {
  const names = catalog.filter(model => model.family === family).map(model => model.name);
  if (!names.length) return family;
  let prefix = names[0];
  for (const name of names) while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const word = prefix.length === names[0].length ? prefix : prefix.replace(/[\s.-]*\S*$/, '');
  return word.trim() || names[0];
}

// 文本类会话参数（JSON、路径）离开输入框时才保存，避免输入到一半的内容被当作无效设置拒绝。
function CommitText({ label, value, multiline, commit }: { label: string; value: string; multiline?: boolean; commit: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  if (value !== saved) { setSaved(value); setText(value); }
  const blur = () => { if (text !== value) commit(text); };
  return multiline ? <TextArea label={label} value={text} rows={3} maxLength={10000} onChange={setText} onBlur={blur} />
    : <TextInput label={label} value={text} onChange={next => setText(next.slice(0, 4096))} onBlur={blur} />;
}

// 设置 › 推理引擎 › 运行参数：对所有模型生效，修改后下一次任务按新参数重新加载模型。
// 模型会话参数是引擎的专家选项，默认收起，只列出当前引擎为该模型声明支持的键。
export function EngineRuntimeSettings({ state, catalog, run }: { state: State; catalog: ModelPackage[]; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const preferences = state.preferences;
  const engine = preferences.engine ?? {};
  const session = engine.session ?? {};
  const families = Object.keys(options).filter(family => state.runtimeSessionOptions?.[family]?.length);
  const [family, setFamily] = useState('');
  const current = families.includes(family) ? family : families[0] ?? '';
  const [notice, setNotice] = useState('');
  const [unloading, setUnloading] = useState(false);
  const save = (patch: Partial<EngineSettings>) => run(() => call('preferences.save', { ...preferences, engine: { ...engine, ...patch } }));
  const saveSession = (key: string, value?: Value) => {
    const next = { ...session };
    if (value === undefined) delete next[key]; else next[key] = value;
    save({ session: next });
  };
  // 已保存但当前引擎不再支持的会话参数：提示出来并可一键清掉，否则对应模型生成时会报错。
  const stale = Object.keys(session).filter(key => !(state.runtimeSessionOptions?.[key.split('.')[0]] ?? []).includes(key));
  const unload = () => {
    setUnloading(true); setNotice('');
    void call('runtime.unload').then(() => setNotice('@yovoice.runtime.unloaded'), error => setNotice(noticeMessage(error))).finally(() => setUnloading(false));
  };
  return <SettingsGroup title={t('@yovoice.runtime.title')} description={t('@yovoice.runtime.help')} actions={<HStack gap={2}>
    <Button size="sm" variant="secondary" label={t('@yovoice.runtime.unload')} isLoading={unloading} isDisabled={state.activity?.status === 'running' || unloading} onClick={unload} />
    <Button size="sm" variant="secondary" label={t('@yovoice.runtime.reset')} isDisabled={!preferences.engine} onClick={() => run(() => call('preferences.save', { ...preferences, engine: undefined }))} />
  </HStack>}>
    <EngineStatus policy />
    {notice ? <SettingsRow label={<small role="status">{formatNotice(t, notice)}</small>} /> : null}
    <SettingsRow className="engine-setting-row" label={t('@yovoice.runtime.threads')}>
      <NumberInput size="sm" label={t('@yovoice.runtime.threads')} isLabelHidden isIntegerOnly min={0} max={256} value={engine.threads ?? 0} onChange={threads => save({ threads })} width="calc(var(--spacing-10) * 3)" />
    </SettingsRow>
    {preferences.backend !== 'cpu' ? <SettingsRow className="engine-setting-row" label={t('@yovoice.runtime.device')}>
      <NumberInput size="sm" label={t('@yovoice.runtime.device')} isLabelHidden isIntegerOnly min={0} max={255} value={engine.device ?? 0} onChange={device => save({ device })} width="calc(var(--spacing-10) * 3)" />
    </SettingsRow> : null}
    <SettingsRow className="engine-setting-row" label={t('@yovoice.runtime.idle')}>
      <NumberInput size="sm" label={t('@yovoice.runtime.idle')} isLabelHidden isIntegerOnly min={0} max={86400} value={engine.idleUnloadSeconds ?? 300} onChange={idleUnloadSeconds => save({ idleUnloadSeconds })} width="calc(var(--spacing-10) * 3)" />
    </SettingsRow>
    {stale.length ? <SettingsRow label={<small role="alert">{t('@yovoice.error.modelOptionUnsupported', { name: stale.join(' · ') })}</small>}>
      <Button size="sm" variant="secondary" label={t('@yovoice.runtime.clearUnsupported')} onClick={() => save({ session: Object.fromEntries(Object.entries(session).filter(([key]) => !stale.includes(key))) })} />
    </SettingsRow> : null}
    {families.length ? <details className="engine-session" data-testid="engine-session">
      <summary><ChevronRight aria-hidden />{t('@yovoice.runtime.session')}</summary>
      <VStack gap={4} className="engine-session-body">
        <small>{t('@yovoice.runtime.sessionHelp')}</small>
        <Selector size="sm" label={t('@yovoice.runtime.sessionModel')} value={current} options={families.map(value => ({ value, label: familyName(catalog, value) }))} onChange={setFamily} width="calc(var(--spacing-10) * 6)" />
        {options[current].filter(spec => state.runtimeSessionOptions?.[current]?.includes(spec.key)).map(spec => {
          const label = spec.key.slice(current.length + 1);
          const value = session[spec.key] ?? spec.default;
          if (spec.type === 'boolean') return <Switch key={spec.key} size="sm" label={label} value={Boolean(value)} onChange={next => saveSession(spec.key, next)} />;
          if (spec.type === 'select') return <Selector key={spec.key} size="sm" label={label} value={String(value ?? spec.values?.[0] ?? '')} options={(spec.values ?? []).map(item => ({ value: item, label: item }))} onChange={next => saveSession(spec.key, next)} />;
          if (spec.type === 'json' || spec.type === 'path') return <CommitText key={spec.key} label={label} multiline={spec.type === 'json'} value={String(session[spec.key] ?? '')} commit={next => saveSession(spec.key, next.trim() || undefined)} />;
          return <NumberInput key={spec.key} size="sm" label={label} min={spec.min} max={spec.max} step={spec.step} isIntegerOnly={spec.step === 1} hasClear placeholder={t('@yovoice.reference.auto')} value={typeof value === 'number' ? value : null} onChange={(next: number | null) => saveSession(spec.key, next ?? undefined)} />;
        })}
      </VStack>
    </details> : null}
  </SettingsGroup>;
}
