import { useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowUpRight, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { AppDialog, ConfirmDelete } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { call, CallError } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import aiPresets from '../../shared/lib/ai-presets.json';
import type { AIProvider, AITest, State } from '../../shared/workbench';

export interface AIPreset { key: string; name: string; format: string; baseURL: string; modelsPath: string; keyURL?: string; endpoint: string }
export const presets = aiPresets as AIPreset[];
const formats = ['chat_completions', 'responses', 'anthropic_messages'];

type Editing = AIProvider & { key: string };

// 服务编辑：固定地址的服务只填密钥和模型；本地服务可改地址；自定义服务可改协议与模型列表路径。
function ProviderEditor({ initial, close }: { initial: Editing; close: () => void }) {
  const t = useTranslator();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState<'' | 'save' | 'models' | 'test'>('');
  const [error, setError] = useState('');
  const [test, setTest] = useState<AITest | undefined>(initial.lastTest);
  const preset = presets.find(p => p.key === value.preset) ?? presets.at(-1)!;
  const presetName = (p: AIPreset) => p.key === 'custom' ? t('@yovoice.ai.customProvider') : p.name;
  const patch = (next: Partial<Editing>) => setValue(current => ({ ...current, ...next }));
  // 先保存再获取模型或测试；只有填写了新密钥时才提交密钥。
  async function save() {
    const saved = await call<AIProvider>('ai.provider.save', { id: value.id, preset: value.preset, name: value.name, format: value.format, baseURL: value.baseURL, modelsPath: value.modelsPath, model: value.model, ...(value.key ? { key: value.key } : {}) });
    setValue(current => ({ ...current, ...saved, key: '' }));
    return saved;
  }
  async function act(kind: 'save' | 'models' | 'test') {
    setBusy(kind); setError('');
    try {
      const saved = await save();
      if (kind === 'save') { close(); return; }
      if (kind === 'models') {
        const models = await call<string[]>('ai.models', { id: saved.id });
        patch({ models, model: saved.model || models[0] || '' });
      } else setTest(await call<AITest>('ai.test', { id: saved.id }));
    } catch (e) { setError(formatCallError(t, e)); }
    finally { setBusy(''); }
  }
  const testMessage = test ? test.ok ? t('@yovoice.ai.testOk') : t('@yovoice.ai.testFailed', { reason: formatCallError(t, new CallError(test.code as never, test.params as never)) }) : '';
  return <AppDialog title={value.id ? t('@yovoice.ai.editProvider') : t('@yovoice.ai.addProvider')} width={520} busy={!!busy} error={error} onClose={close} closeLabel={t('@yovoice.action.cancel')} actions={<>
    <Button label={t('@yovoice.ai.fetchModels')} variant="secondary" isLoading={busy === 'models'} isDisabled={!!busy || !value.modelsPath} onClick={() => void act('models')} />
    <Button label={t('@yovoice.ai.test')} variant="secondary" isLoading={busy === 'test'} isDisabled={!!busy || !value.model.trim()} onClick={() => void act('test')} />
    <Button label={t('@yovoice.action.save')} variant="primary" isLoading={busy === 'save'} isDisabled={!!busy} onClick={() => void act('save')} />
  </>}>
    <Selector label={t('@yovoice.ai.provider')} value={value.preset} isDisabled={!!value.id} options={presets.map(p => ({ value: p.key, label: presetName(p) }))}
      onChange={key => { const p = presets.find(x => x.key === key)!; patch({ preset: p.key, name: '', format: p.format, baseURL: p.baseURL, modelsPath: p.modelsPath, models: undefined, model: '' }); }} />
    <TextInput label={t('@yovoice.ai.name')} value={value.name} placeholder={presetName(preset)} onChange={name => patch({ name: name.slice(0, 60) })} />
    {preset.endpoint === 'fixed' ? <small className="ai-endpoint">{value.baseURL}</small>
      : <TextInput label={t('@yovoice.ai.baseURL')} value={value.baseURL} placeholder="https://example.com/v1" onChange={baseURL => patch({ baseURL })} />}
    {preset.endpoint === 'custom' ? <HStack gap={3} wrap="wrap">
      <Selector label={t('@yovoice.ai.format')} value={value.format} options={formats.map(f => ({ value: f, label: t(`@yovoice.ai.formatName.${f}`) }))} onChange={format => patch({ format })} />
      <TextInput label={t('@yovoice.ai.modelsPath')} value={value.modelsPath} placeholder="/models" onChange={modelsPath => patch({ modelsPath })} />
    </HStack> : null}
    <VStack gap={1}>
      <TextInput label={t('@yovoice.ai.key')} type="password" autoComplete="off" value={value.key} placeholder={value.keyMask || (preset.endpoint === 'local' ? t('@yovoice.ai.keyOptional') : '')} onChange={key => patch({ key })} />
      <HStack gap={2} vAlign="center" wrap="wrap">
        <small>{t('@yovoice.ai.keyStored')}</small>
        {preset.keyURL ? <Button size="sm" variant="ghost" icon={<ArrowUpRight />} label={t('@yovoice.ai.getKey')} onClick={() => window.open(preset.keyURL, '_blank', 'noopener')} /> : null}
      </HStack>
    </VStack>
    <TextInput label={t('@yovoice.ai.model')} value={value.model} placeholder={t('@yovoice.ai.modelPlaceholder')} onChange={model => patch({ model: model.slice(0, 200) })} />
    {value.models?.length ? <Selector label={t('@yovoice.ai.availableModels', { count: value.models.length })} value={value.models.includes(value.model) ? value.model : ''} placeholder={t('@yovoice.ai.pickModel')} options={value.models.map(m => ({ value: m, label: m }))} onChange={model => patch({ model })} /> : null}
    {testMessage ? <p className={test?.ok ? 'ai-test ok' : 'ai-test failed'} role="status">{testMessage}</p> : null}
  </AppDialog>;
}

// 设置 › AI：可选的大模型服务。配置后可在编曲中让 AI 写谱、在音乐生成中让 AI 写歌词。
export function AISettings({ state, run }: { state: State; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<AIProvider | null>(null);
  const [adding, setAdding] = useState('');
  const providers = state.aiProviders ?? [];
  const add = (key: string) => { const p = presets.find(x => x.key === key)!; setEditing({ id: '', preset: p.key, name: '', format: p.format, baseURL: p.baseURL, modelsPath: p.modelsPath, model: '', key: '' }); setAdding(''); };
  return <VStack gap={5} id="ai-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabAI')}>
    <VStack gap={2}>
      <HStack gap={2} vAlign="center"><Sparkles size={18} strokeWidth={1.5} aria-hidden /><h2>{t('@yovoice.ai.title')}</h2><small className="ai-optional">{t('@yovoice.ai.optional')}</small></HStack>
      <p className="muted">{t('@yovoice.ai.intro')}</p>
    </VStack>
    {providers.length ? <VStack className="ai-providers" gap={0} role="list" aria-label={t('@yovoice.ai.providers')}>
      {providers.map(p => <HStack key={p.id} className="ai-provider-row" role="listitem" gap={3} vAlign="center" wrap="wrap">
        <Avatar name={p.preset === 'custom' ? p.name : presets.find(x => x.key === p.preset)?.name ?? p.name} shape="rounded" tooltip={false} />
        <VStack className="grow" gap={0}>
          <HStack gap={2} vAlign="center"><b>{p.name}</b>{p.id === state.aiProviderID ? <small className="ai-in-use">{t('@yovoice.ai.inUse')}</small> : null}</HStack>
          <HStack gap={2} vAlign="center">
            <small className="ai-model">{p.model || t('@yovoice.ai.noModel')}</small>
            <StatusDot variant={p.lastTest ? p.lastTest.ok ? 'success' : 'error' : 'neutral'} label={p.lastTest ? p.lastTest.ok ? t('@yovoice.ai.lastTestOk') : t('@yovoice.ai.lastTestFailed') : t('@yovoice.ai.untested')} />
            <small>{p.lastTest ? p.lastTest.ok ? t('@yovoice.ai.lastTestOk') : t('@yovoice.ai.lastTestFailed') : t('@yovoice.ai.untested')}</small>
          </HStack>
        </VStack>
        {p.id !== state.aiProviderID ? <Button size="sm" variant="secondary" label={t('@yovoice.ai.use')} onClick={() => run(() => call('ai.provider.use', { id: p.id }))} /> : null}
        <Button size="sm" variant="ghost" isIconOnly icon={<Pencil />} label={t('@yovoice.ai.editNamed', { name: p.name })} onClick={() => setEditing({ ...p, key: '' })} />
        <Button size="sm" variant="ghost" isIconOnly icon={<Trash2 />} label={t('@yovoice.ai.deleteNamed', { name: p.name })} onClick={() => setRemoving(p)} />
      </HStack>)}
    </VStack> : <p className="ai-empty">{t('@yovoice.ai.empty')}</p>}
    <Selector label={t('@yovoice.ai.addProvider')} isLabelHidden size="sm" width="calc(var(--spacing-10) * 5)" value={adding} placeholder={t('@yovoice.ai.addProvider')} options={presets.map(p => ({ value: p.key, label: p.key === 'custom' ? t('@yovoice.ai.customProvider') : p.name }))} onChange={add} />
    {editing ? <ProviderEditor key={editing.id || editing.preset} initial={editing} close={() => setEditing(null)} /> : null}
    {removing ? <ConfirmDelete title={t('@yovoice.ai.deleteTitle')} description={t('@yovoice.ai.deleteBody', { name: removing.name })} confirmLabel={t('@yovoice.action.delete')} busy={false} onClose={() => setRemoving(null)} onConfirm={() => { const id = removing.id; setRemoving(null); run(() => call('ai.provider.delete', { id })); }} /> : null}
  </VStack>;
}
