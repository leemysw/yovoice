import { useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowUpRight, Check, Play, RefreshCw, Search, Trash2 } from 'lucide-react';
import { ConfirmDelete } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { call, CallError } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import aiPresets from '../../shared/lib/ai-presets.json';
import type { AIProvider, AITest, State } from '../../shared/workbench';

export interface AIPreset { key: string; name: string; format: string; baseURL: string; modelsPath: string; keyURL?: string; endpoint: string }
export const presets = aiPresets as AIPreset[];
const formats = ['chat_completions', 'responses', 'anthropic_messages'];

type Editing = AIProvider & { key: string };
const fresh = (p: AIPreset): Editing => ({ id: '', preset: p.key, name: '', format: p.format, baseURL: p.baseURL, modelsPath: p.modelsPath, model: '', key: '' });

// 服务标识：只取名称首字做单色方块，不用表情或彩色图标。
function ProviderMark({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  return <Avatar className="ai-mark" name={[...name.trim()][0]?.toUpperCase() ?? ''} size={size} shape="rounded" tooltip={false} />;
}

// 右侧详情：密钥、服务地址和模型在同一页直接编辑；测试和同步模型前先保存。
function ProviderDetail({ provider, preset, current, run, saved, removed }: {
  provider?: AIProvider; preset: AIPreset; current: boolean; run: (task: () => Promise<unknown>) => void;
  saved: (id: string) => void; removed: () => void;
}) {
  const t = useTranslator();
  const initial: Editing = provider ? { ...provider, key: '' } : fresh(preset);
  const [value, setValue] = useState(initial);
  const [replacingKey, setReplacingKey] = useState(!provider?.keyMask);
  const [busy, setBusy] = useState<'' | 'save' | 'models' | 'test' | 'key'>('');
  const [error, setError] = useState('');
  const [test, setTest] = useState<AITest | undefined>(provider?.lastTest);
  const [filter, setFilter] = useState('');
  const [removing, setRemoving] = useState(false);
  const presetName = preset.key === 'custom' ? t('@yovoice.ai.customProvider') : preset.name;
  const title = value.name || provider?.name || presetName;
  const patch = (next: Partial<Editing>) => setValue(v => ({ ...v, ...next }));
  const dirty = !provider || !!value.key || (['name', 'format', 'baseURL', 'modelsPath', 'model'] as const).some(k => (value[k] ?? '') !== (provider[k] ?? ''));
  const models = value.models ?? provider?.models ?? [];
  const shown = models.filter(m => m.toLowerCase().includes(filter.trim().toLowerCase()));
  // 只有填写了新密钥才提交密钥；清除密钥时提交空串。
  async function save(key: string | undefined = value.key || undefined) {
    const result = await call<AIProvider>('ai.provider.save', { id: value.id, preset: value.preset, name: value.name, format: value.format, baseURL: value.baseURL, modelsPath: value.modelsPath, model: value.model, ...(key !== undefined ? { key } : {}) });
    setValue(v => ({ ...v, ...result, key: '' }));
    setReplacingKey(!result.keyMask);
    if (!value.id) saved(result.id);
    return result;
  }
  async function act(kind: 'save' | 'models' | 'test' | 'key') {
    setBusy(kind); setError('');
    try {
      const result = await save(kind === 'key' ? '' : undefined);
      if (kind === 'models') {
        const list = await call<string[]>('ai.models', { id: result.id });
        patch({ models: list, model: result.model || list[0] || '' });
      } else if (kind === 'test') setTest(await call<AITest>('ai.test', { id: result.id }));
    } catch (e) { setError(formatCallError(t, e)); }
    finally { setBusy(''); }
  }
  const testMessage = test ? test.ok ? t('@yovoice.ai.testOk') : t('@yovoice.ai.testFailed', { reason: formatCallError(t, new CallError(test.code as never, test.params as never)) }) : '';
  return <VStack className="ai-detail grow" gap={6} aria-label={title}>
    <HStack className="ai-detail-head" hAlign="between" vAlign="center" gap={3} wrap="wrap">
      <HStack gap={3} vAlign="center">
        <ProviderMark name={title} size="md" />
        <h2>{title}</h2>
        {provider ? current ? <Token size="sm" color="green" label={t('@yovoice.ai.inUse')} /> : null : <Token size="sm" label={t('@yovoice.ai.notAdded')} />}
      </HStack>
      {provider ? <HStack gap={4} vAlign="center">
        <Button size="sm" label={t('@yovoice.ai.test')} icon={<Play />} isLoading={busy === 'test'} isDisabled={!!busy || !value.model.trim()} onClick={() => void act('test')} />
        <Switch label={t('@yovoice.ai.enable')} value={current} onChange={on => run(() => call('ai.provider.use', { id: on ? provider.id : '' }))} />
      </HStack> : null}
    </HStack>

    {preset.endpoint === 'custom' ? <TextInput label={t('@yovoice.ai.name')} value={value.name} placeholder={presetName} onChange={name => patch({ name: name.slice(0, 60) })} /> : null}

    <VStack className="ai-field" gap={2}>
      {provider?.keyMask && !replacingKey ? <>
        <p className="ai-field-title">{t('@yovoice.ai.key')}</p>
        <HStack gap={2} vAlign="center">
          <code className="ai-value grow" aria-label={t('@yovoice.ai.key')}>{value.keyMask ?? provider.keyMask}</code>
          <Button size="sm" label={t('@yovoice.ai.replaceKey')} onClick={() => setReplacingKey(true)} />
          <Button size="sm" variant="ghost" label={t('@yovoice.ai.clearKey')} isLoading={busy === 'key'} isDisabled={!!busy} onClick={() => void act('key')} />
        </HStack>
      </> : <TextInput label={t('@yovoice.ai.key')} type="password" autoComplete="off" value={value.key} placeholder={preset.endpoint === 'local' ? t('@yovoice.ai.keyOptional') : provider?.keyMask ? '••••••••' : t('@yovoice.ai.keyNotSet')} onChange={key => patch({ key })} />}
      <HStack gap={3} vAlign="center" wrap="wrap">
        {preset.keyURL ? <Button className="ai-link" size="sm" variant="ghost" label={t('@yovoice.ai.getKeyFrom', { name: preset.name })} endContent={<ArrowUpRight size={14} />} onClick={() => window.open(preset.keyURL, '_blank', 'noopener')} /> : null}
        <small>{t('@yovoice.ai.keyStored')}</small>
      </HStack>
    </VStack>

    <VStack className="ai-field" gap={2}>
      {preset.endpoint === 'fixed' ? <>
        <p className="ai-field-title">{t('@yovoice.ai.baseURL')}</p>
        <HStack className="ai-value" gap={3} vAlign="center"><Token size="sm" label={t(`@yovoice.ai.formatName.${value.format}`)} /><code>{value.baseURL}</code></HStack>
      </> : <>
        {preset.endpoint === 'custom' ? <Selector label={t('@yovoice.ai.format')} value={value.format} options={formats.map(f => ({ value: f, label: t(`@yovoice.ai.formatName.${f}`) }))} onChange={format => patch({ format })} /> : null}
        <TextInput label={t('@yovoice.ai.baseURL')} value={value.baseURL} placeholder="https://example.com/v1" onChange={baseURL => patch({ baseURL })} />
        {preset.endpoint === 'custom' ? <TextInput label={t('@yovoice.ai.modelsPath')} value={value.modelsPath} placeholder="/models" onChange={modelsPath => patch({ modelsPath })} /> : null}
      </>}
    </VStack>

    <VStack className="ai-field" gap={3}>
      <HStack hAlign="between" vAlign="center" gap={3}>
        <HStack gap={2} vAlign="center"><p className="ai-field-title">{t('@yovoice.ai.model')}</p>{models.length ? <Badge label={models.length} /> : null}</HStack>
        <Button size="sm" label={t('@yovoice.ai.syncModels')} icon={<RefreshCw />} isLoading={busy === 'models'} isDisabled={!!busy || !value.modelsPath} onClick={() => void act('models')} />
      </HStack>
      <TextInput label={t('@yovoice.ai.currentModel')} isLabelHidden value={value.model} placeholder={t('@yovoice.ai.modelPlaceholder')} onChange={model => patch({ model: model.slice(0, 200) })} />
      {models.length ? <>
        {models.length > 8 ? <TextInput size="sm" label={t('@yovoice.ai.searchModels')} isLabelHidden startIcon={<Search />} placeholder={t('@yovoice.ai.searchModels')} value={filter} onChange={setFilter} /> : null}
        <List className="ai-models" density="compact" hasDividers>{shown.map(m => <ListItem key={m} label={m} isSelected={m === value.model} endContent={m === value.model ? <Check size={16} aria-hidden /> : null} onClick={() => patch({ model: m })} />)}</List>
      </> : <small>{t('@yovoice.ai.noModels')}</small>}
    </VStack>

    {testMessage ? <p className={test?.ok ? 'ai-test ok' : 'ai-test failed'} role="status">{testMessage}</p> : null}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}

    <HStack className="ai-detail-foot" hAlign="between" vAlign="center" gap={3} wrap="wrap">
      {provider ? <Button size="sm" variant="ghost" icon={<Trash2 />} label={t('@yovoice.ai.removeProvider')} isDisabled={!!busy} onClick={() => setRemoving(true)} /> : <small />}
      <HStack gap={3} vAlign="center">
        {provider && dirty ? <small>{t('@yovoice.ai.unsaved')}</small> : null}
        <Button variant="primary" label={provider ? t('@yovoice.ai.saveChanges') : t('@yovoice.ai.saveProvider')} isLoading={busy === 'save'} isDisabled={!!busy || !dirty} onClick={() => void act('save')} />
      </HStack>
    </HStack>
    {removing && provider ? <ConfirmDelete title={t('@yovoice.ai.deleteTitle')} description={t('@yovoice.ai.deleteBody', { name: provider.name })} confirmLabel={t('@yovoice.action.delete')} busy={false} onClose={() => setRemoving(false)} onConfirm={() => { setRemoving(false); removed(); run(() => call('ai.provider.delete', { id: provider.id })); }} /> : null}
  </VStack>;
}

// 设置 › AI 服务：左侧是已添加和可添加的服务，右侧直接编辑选中的服务。
export function AISettings({ state, run }: { state: State; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const providers = state.aiProviders ?? [];
  const firstChoice = () => state.aiProviderID || providers[0]?.id || `preset:${presets[0].key}`;
  // nonce 只在用户切换选中项时变化；保存新服务后选中项换成它的 ID，但编辑区不重建。
  const [selection, setSelection] = useState(() => ({ value: firstChoice(), nonce: 0 }));
  const select = (value: string) => setSelection(s => ({ value, nonce: s.nonce + 1 }));
  const provider = providers.find(p => p.id === selection.value);
  const presetKey = provider?.preset ?? (selection.value.startsWith('preset:') ? selection.value.slice(7) : presets[0].key);
  const preset = presets.find(p => p.key === presetKey) ?? presets.at(-1)!;
  const addable = presets.filter(p => p.key === 'custom' || !providers.some(x => x.preset === p.key));
  const presetName = (p: AIPreset) => p.key === 'custom' ? t('@yovoice.ai.customProvider') : p.name;
  return <VStack className="settings-panel ai-panel" gap={4} id="ai-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabAI')}>
    <small className="settings-intro">{t('@yovoice.ai.intro')}</small>
    <HStack className="ai-split" gap={0}>
      <VStack className="ai-nav" gap={4}>
        {providers.length ? <List header={<small className="ai-nav-head">{t('@yovoice.ai.added')}</small>} density="compact">
          {providers.map(p => <ListItem key={p.id} label={p.name} isSelected={p.id === selection.value} startContent={<ProviderMark name={p.name} />}
            endContent={p.id === state.aiProviderID ? <StatusDot variant="success" label={t('@yovoice.ai.inUse')} tooltip={t('@yovoice.ai.inUse')} /> : null} onClick={() => select(p.id)} />)}
        </List> : null}
        <List header={<small className="ai-nav-head">{t('@yovoice.ai.addable')}</small>} density="compact">
          {addable.map(p => <ListItem key={p.key} label={presetName(p)} isSelected={selection.value === `preset:${p.key}`} startContent={<ProviderMark name={presetName(p)} />} onClick={() => select(`preset:${p.key}`)} />)}
        </List>
      </VStack>
      <ProviderDetail key={selection.nonce} provider={provider} preset={preset} current={!!provider && provider.id === state.aiProviderID} run={run}
        saved={id => setSelection(s => ({ ...s, value: id }))} removed={() => select(providers.find(p => p.id !== provider?.id)?.id ?? `preset:${preset.key}`)} />
    </HStack>
  </VStack>;
}
