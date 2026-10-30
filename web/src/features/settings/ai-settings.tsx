import { useCallback, useEffect, useEffectEvent, useState, type CSSProperties } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowUpRight, Check, LogIn, Play, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { ConfirmDelete } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { OrcaConnect } from '../../shared/ui/orca-connect';
import { call, CallError, isDesktop } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import aiPresets from '@internal/llm/presets.json';
import { type AIProvider, type AITest, type CodexInfo, type State } from '../../shared/workbench';

export interface AIPreset { key: string; name: string; format: string; baseURL: string; modelsPath: string; keyURL?: string; endpoint: string; plan?: string; icon?: string }
export const presets = aiPresets as AIPreset[];
const formats = ['chat_completions', 'responses', 'anthropic_messages'];
// AI 请求超时的可选值（秒）。

type Editing = AIProvider & { key: string };
const fresh = (p: AIPreset): Editing => ({ id: '', preset: p.key, name: '', format: p.format, baseURL: p.baseURL, modelsPath: p.modelsPath, model: '', key: '' });

// 服务商图标来自 Lobe Icons，统一按文字色单色显示；没有图标的服务显示名称首字，自定义服务显示加号。
const icons = import.meta.glob('../../shared/assets/provider-icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const iconURL = (name?: string) => name ? icons[`../../shared/assets/provider-icons/${name}.svg`] : undefined;
function initials(name: string) {
  const words = name.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2 && /^[A-Za-z]/.test(words[0])) return (words[0][0] + words[1][0]).toUpperCase();
  return [...(words[0] ?? 'AI')].slice(0, /^[A-Za-z]/.test(words[0] ?? 'A') ? 2 : 1).join('').toUpperCase();
}
function ProviderIcon({ preset, name, size = 'sm', active = false }: { preset?: AIPreset; name: string; size?: 'sm' | 'md'; active?: boolean }) {
  const src = iconURL(preset?.icon);
  return <HStack className="ai-icon" data-size={size} data-active={active} data-custom={preset?.key === 'custom' && !active} hAlign="center" vAlign="center" gap={0} aria-hidden>
    {src ? <HStack className="ai-icon-glyph" gap={0} style={{ '--ai-icon': `url("${src}")` } as CSSProperties} />
      : preset?.key === 'custom' && !active ? <Plus size={14} /> : <b>{initials(name)}</b>}
  </HStack>;
}

// ChatGPT 订阅（Codex）：检测本机 Codex CLI 的安装与登录状态；登录由 CLI 在浏览器里完成，yovoice 不接触凭证。
function CodexStatus() {
  const t = useTranslator();
  const [info, setInfo] = useState<CodexInfo | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'login'>('check');
  const [error, setError] = useState('');
  const check = useCallback(async () => {
    setBusy('check'); setError('');
    try { setInfo(await call<CodexInfo>('ai.codex.status')); } catch (e) { setError(formatCallError(t, e)); } finally { setBusy(''); }
  }, [t]);
  useEffect(() => { void check(); }, [check]);
  const login = async () => {
    setBusy('login'); setError('');
    try { await call('ai.codex.login'); } catch (e) { setError(formatCallError(t, e)); } finally { setBusy(''); }
  };
  const status = !info ? '' : !info.path ? t('@yovoice.ai.codex.missing')
    : info.login === 'chatgpt' ? t('@yovoice.ai.codex.chatgpt', { version: info.version ?? '' })
      : info.login === 'apikey' ? t('@yovoice.ai.codex.apiKey', { version: info.version ?? '' }) : t('@yovoice.ai.codex.loggedOut', { version: info.version ?? '' });
  return <VStack className="ai-field" gap={2}>
    <p className="ai-field-title">{t('@yovoice.ai.codex.title')}</p>
    <HStack gap={2} vAlign="center" wrap="wrap">
      {info ? <StatusDot variant={info.login === 'chatgpt' ? 'success' : info.path ? 'warning' : 'error'} label={status} /> : null}
      <small className="grow" role="status">{busy === 'check' ? t('@yovoice.ai.codex.checking') : status}</small>
      <Button size="sm" variant="ghost" label={t('@yovoice.ai.codex.check')} icon={<RefreshCw />} isLoading={busy === 'check'} isDisabled={!!busy} onClick={() => void check()} />
      {info?.path && info.login !== 'chatgpt' ? <Button size="sm" variant="primary" label={t('@yovoice.ai.codex.login')} icon={<LogIn />} isLoading={busy === 'login'} isDisabled={!!busy || !isDesktop} onClick={() => void login()} /> : null}
    </HStack>
    {info && !info.path ? <HStack gap={0}><Button className="ai-link" size="sm" variant="ghost" label={t('@yovoice.ai.codex.install')} endContent={<ArrowUpRight size={14} />} onClick={() => window.open('https://github.com/openai/codex', '_blank', 'noopener')} /></HStack> : null}
    <small>{t('@yovoice.ai.codex.hint')}</small>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
  </VStack>;
}

// 右侧详情：密钥、服务地址和模型在同一页直接编辑；测试和同步模型前先保存。
// 当前使用哪个服务和模型在写作栏里切换，这里只保留必要的配置，标题行固定一行，切换服务时布局不跳动。
function ProviderDetail({ provider, preset, run, saved, removed }: {
  provider?: AIProvider; preset: AIPreset; run: (task: () => Promise<unknown>) => void;
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
  const cli = preset.endpoint === 'cli';
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
      // Codex 没有填写模型时，保存后读取 CLI 的模型目录并选中第一个，写作栏才能直接使用。
      if (kind === 'models' || cli && kind === 'save' && !result.model) {
        const list = await call<string[]>('ai.models', { id: result.id });
        patch({ models: list, model: result.model || list[0] || '' });
      } else if (kind === 'test') setTest(await call<AITest>('ai.test', { id: result.id }));
    } catch (e) { setError(formatCallError(t, e)); }
    finally { setBusy(''); }
  }
  const testMessage = test ? test.ok ? t('@yovoice.ai.testOk') : t('@yovoice.ai.testFailed', { reason: formatCallError(t, new CallError(test.code as never, test.params as never)) }) : '';
  return <VStack className="ai-detail grow" gap={5} aria-label={title}>
    <HStack className="ai-detail-head" vAlign="center" gap={3}>
      <ProviderIcon preset={preset} name={title} size="md" active={!!provider} />
      <h2 className="grow">{title}</h2>
      {provider ? <Button size="sm" label={t('@yovoice.ai.test')} icon={<Play />} isLoading={busy === 'test'} isDisabled={!!busy || !value.model.trim()} onClick={() => void act('test')} /> : null}
    </HStack>

    {preset.endpoint === 'custom' ? <TextInput size="sm" label={t('@yovoice.ai.name')} value={value.name} placeholder={presetName} onChange={name => patch({ name: name.slice(0, 60) })} /> : null}

    {preset.key === 'orcarouter' ? <OrcaConnect variant={provider?.keyMask ? 'secondary' : 'primary'} hint /> : null}

    {cli ? <CodexStatus /> : <><VStack className="ai-field" gap={2}>
      {provider?.keyMask && !replacingKey ? <>
        <p className="ai-field-title">{t('@yovoice.ai.key')}</p>
        <HStack gap={2} vAlign="center">
          <code className="ai-value grow" aria-label={t('@yovoice.ai.key')}>{value.keyMask ?? provider.keyMask}</code>
          <Button size="sm" label={t('@yovoice.ai.replaceKey')} onClick={() => setReplacingKey(true)} />
          <Button size="sm" variant="ghost" label={t('@yovoice.ai.clearKey')} isLoading={busy === 'key'} isDisabled={!!busy} onClick={() => void act('key')} />
        </HStack>
      </> : <TextInput size="sm" label={t('@yovoice.ai.key')} type="password" autoComplete="off" value={value.key} placeholder={preset.endpoint === 'local' ? t('@yovoice.ai.keyOptional') : provider?.keyMask ? '••••••••' : t('@yovoice.ai.keyNotSet')} onChange={key => patch({ key })} />}
      {preset.keyURL ? <HStack gap={0}><Button className="ai-link" size="sm" variant="ghost" label={t('@yovoice.ai.getKeyFrom', { name: preset.name })} endContent={<ArrowUpRight size={14} />} onClick={() => window.open(preset.keyURL, '_blank', 'noopener')} /></HStack> : null}
    </VStack>

    <VStack className="ai-field" gap={2}>
      {preset.endpoint === 'fixed' ? <>
        <p className="ai-field-title">{t('@yovoice.ai.baseURL')}</p>
        <code className="ai-value">{value.baseURL}</code>
      </> : <>
        {preset.endpoint === 'custom' ? <Selector label={t('@yovoice.ai.format')} value={value.format} options={formats.map(f => ({ value: f, label: t(`@yovoice.ai.formatName.${f}`) }))} onChange={format => patch({ format })} /> : null}
        <TextInput size="sm" label={t('@yovoice.ai.baseURL')} value={value.baseURL} placeholder="https://example.com/v1" onChange={baseURL => patch({ baseURL })} />
        {preset.endpoint === 'custom' ? <TextInput size="sm" label={t('@yovoice.ai.modelsPath')} value={value.modelsPath} placeholder="/models" onChange={modelsPath => patch({ modelsPath })} /> : null}
      </>}
    </VStack></>}

    <VStack className="ai-field" gap={3}>
      <HStack hAlign="between" vAlign="center" gap={3}>
        <HStack gap={2} vAlign="center"><p className="ai-field-title">{t('@yovoice.ai.model')}</p>{models.length ? <Badge label={models.length} /> : null}</HStack>
        <Button size="sm" label={t('@yovoice.ai.syncModels')} icon={<RefreshCw />} isLoading={busy === 'models'} isDisabled={!!busy || !value.modelsPath && !cli} onClick={() => void act('models')} />
      </HStack>
      <TextInput size="sm" label={t('@yovoice.ai.currentModel')} isLabelHidden value={value.model} placeholder={t('@yovoice.ai.modelPlaceholder')} onChange={model => patch({ model: model.slice(0, 200) })} />
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
        <Button size="sm" variant="primary" label={provider ? t('@yovoice.ai.saveChanges') : t('@yovoice.ai.saveProvider')} isLoading={busy === 'save'} isDisabled={!!busy || !dirty} onClick={() => void act('save')} />
      </HStack>
    </HStack>
    {removing && provider ? <ConfirmDelete title={t('@yovoice.ai.deleteTitle')} description={t('@yovoice.ai.deleteBody', { name: provider.name })} confirmLabel={t('@yovoice.action.delete')} busy={false} onClose={() => setRemoving(false)} onConfirm={() => { setRemoving(false); removed(); run(() => call('ai.provider.delete', { id: provider.id })); }} /> : null}
  </VStack>;
}

// 设置 › AI 服务：左侧是已添加和可添加的服务，右侧直接编辑选中的服务。
export function AISettings({ state, run, focus }: {
  state: State;
  run: (task: () => Promise<unknown>) => void;
  focus?: { tab: string; modelId: string; request: number };
}) {
  const t = useTranslator();
  const providers = state.aiProviders ?? [];
  // 默认打开 provider 列表的第一个：优先已添加列表的首项，未添加时为预设列表的首项。
  const firstChoice = () => providers[0]?.id || `preset:${presets[0].key}`;
  // nonce 只在用户切换选中项时变化；保存新服务后选中项换成它的 ID，但编辑区不重建。
  const [selection, setSelection] = useState(() => ({ value: firstChoice(), nonce: 0 }));
  const select = (value: string) => setSelection(s => ({ value, nonce: s.nonce + 1 }));
  const resetToFirst = useEffectEvent(() => select(firstChoice()));
  useEffect(() => {
    if (focus?.tab === 'ai') resetToFirst();
  }, [focus?.request, focus?.tab]);
  // 在 OrcaRouter 预设页一键授权完成后，直接切到新添加的服务。
  const connected = selection.value === 'preset:orcarouter' ? providers.find(p => p.preset === 'orcarouter')?.id : undefined;
  const selected = connected ?? selection.value;
  const provider = providers.find(p => p.id === selected);
  const presetKey = provider?.preset ?? (selection.value.startsWith('preset:') ? selection.value.slice(7) : presets[0].key);
  const preset = presets.find(p => p.key === presetKey) ?? presets.at(-1)!;
  const addable = presets.filter(p => p.key === 'custom' || !providers.some(x => x.preset === p.key));
  const presetName = (p: AIPreset) => p.key === 'custom' ? t('@yovoice.ai.customProvider') : p.name;
  const presetOf = (p: AIProvider) => presets.find(x => x.key === p.preset);
  // 参照 nexus：按量 API 与编程套餐地址、密钥都不同，分组单独成行；本地与自定义服务放在最后。
  const groups = [
    { key: 'api', items: addable.filter(p => p.endpoint === 'fixed' && p.plan !== 'coding') },
    { key: 'coding', items: addable.filter(p => p.plan === 'coding') },
    { key: 'subscription', items: addable.filter(p => p.endpoint === 'cli') },
    { key: 'local', items: addable.filter(p => p.endpoint === 'local' || p.endpoint === 'custom') },
  ].filter(group => group.items.length);
  return <VStack className="settings-panel ai-panel" gap={4} id="ai-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabAI')}>
    <small className="settings-intro">{t('@yovoice.ai.intro')}</small>
    <HStack className="ai-split" gap={0}>
      <VStack className="ai-nav" gap={4}>
        {providers.length ? <List header={<small className="ai-nav-head">{t('@yovoice.ai.added')}</small>} density="compact">
          {providers.map(p => <ListItem key={p.id} label={p.name} isSelected={p.id === selected} startContent={<ProviderIcon preset={presetOf(p)} name={p.name} active />}
            endContent={p.id === state.aiProviderID ? <StatusDot variant="success" label={t('@yovoice.ai.inUse')} tooltip={t('@yovoice.ai.inUse')} /> : null} onClick={() => select(p.id)} />)}
        </List> : null}
        {groups.map(group => <List key={group.key} header={<small className="ai-nav-head">{t(`@yovoice.ai.group.${group.key}`)}</small>} density="compact">
          {group.items.map(p => <ListItem key={p.key} label={presetName(p)} isSelected={selection.value === `preset:${p.key}`} startContent={<ProviderIcon preset={p} name={presetName(p)} />} onClick={() => select(`preset:${p.key}`)} />)}
        </List>)}
      </VStack>
      <ProviderDetail key={connected ? `${selection.nonce}:connected` : selection.nonce} provider={provider} preset={preset} run={run}
        saved={id => setSelection(s => ({ ...s, value: id }))} removed={() => select(providers.find(p => p.id !== provider?.id)?.id ?? `preset:${preset.key}`)} />
    </HStack>
  </VStack>;
}
