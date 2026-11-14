import { lazy, Suspense, useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import { FolderOpen, FolderCog, ArrowUpRight } from 'lucide-react';
import { call, isLinux, isMac } from '../../shared/lib/client';
import { aiServiceHidden, featureHidden, runtimeStatus, type EngineInfo, type ModelPackage, type State, type Draft, type UiLocale, modelTab, modelTabs, recognizerFamilies, type ModelKind } from '../../shared/workbench';
import { CallError } from '../../shared/lib/call-error';
import { uiLocales } from '../../shared/i18n/locale';
import { AISettings } from './ai-settings';
import { LocalModelSources } from './local-model-sources';
import { ModelGroups } from './model-list';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';
import { overflowTitle } from '../../shared/ui/overflow-title';
import { UpdateSettings } from '../update/update-settings';
import { LocalAPISettings } from './local-api-settings';
import { StorageSettings } from './storage-settings';
import { LogViewer } from './log-viewer';
import { AssistantSettings } from './assistant-settings';
import { CommunitySettings } from '../community/community-settings';
import { EngineRuntimeSettings } from './engine-runtime-settings';
import { FeatureSettings } from './feature-settings';
import { AppearanceSettings } from './appearance-settings';
import { TranscribeSettings } from './transcribe-settings';
import { HotkeySettings } from './hotkey-settings';

// 资源表格依赖较多，切到资源页时才加载。
const AssetsPage = lazy(() => import('../library/assets-page').then(module => ({ default: module.AssetsPage })));

export function Settings({ state, catalog, engine, draft, run, focus, active, onError, openProject }: {
  focus?: { tab: string; modelId: string; request: number }; state: State; catalog: ModelPackage[]; engine: EngineInfo; draft: Draft; run: (task: () => Promise<unknown>) => void;
  active: boolean; onError: (error: string) => void; openProject: (id: string) => void;
}) {
  const t = useTranslator();
  const [license, setLicense] = useState<string | null>(null);
  const [tab, setTab] = useState('general'); const busy = state.activity?.status === 'running'; const modelBusy = state.modelActivity?.status === 'running';
  const recoveringModels = busy && state.activity?.kind === 'import' && !state.activity.modelId;
  // 模型页上方是共用的下载设置，下面按用途分子页；从别处带着模型跳来时直接打开它所在的子页。
  const [kind, setKind] = useState<ModelKind>('voice-models');
  useEffect(() => {
    if (!focus) return;
    if (modelTabs.includes(focus.tab)) { setTab('models'); setKind(focus.tab as ModelKind); } else setTab(focus.tab);
  }, [focus]);
  const musicHidden = featureHidden(state.preferences, 'music');
  const shownKind: ModelKind = musicHidden && (kind === 'music-models' || kind === 'soundfonts') ? 'voice-models' : kind;
  const kindLabel: Record<ModelKind, string> = { 'voice-models': t('@yovoice.settings.tabModels'), 'music-models': t('@yovoice.settings.tabMusicModels'), soundfonts: t('@yovoice.settings.tabSoundfonts'), 'asr-models': t('@yovoice.settings.tabAsrModels') };
  // 装了不止一个语音识别模型时选用哪个；没选或选的已移除时与后端一样按家族顺序取第一个已装的。
  const recognizers = [...recognizerFamilies].flatMap(family => catalog.filter(model => model.family === family && state.models.some(item => item.id === model.id)));
  const recognizer = recognizers.find(model => model.id === state.preferences.recognizeModel) ?? recognizers[0];
  useEffect(() => {
    if (!focus || tab !== 'models') return;
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-model-ids]')).find(row => row.dataset.modelIds?.split(' ').includes(focus.modelId));
    row?.scrollIntoView({ block: 'nearest' });
  }, [focus, tab, shownKind]);
  const preferences = state.preferences;
  const [proxyURL, setProxyURL] = useState(preferences.proxyURL ?? '');
  const [savingProxy, setSavingProxy] = useState(false);
  const proxyEnabled = preferences.proxyEnabled ?? !!preferences.proxyURL;
  const saveProxy = (enabled: boolean, address = proxyURL.trim()) => run(async () => {
    setSavingProxy(true);
    try { await call('preferences.save', { ...preferences, proxyURL: address, proxyEnabled: enabled }); }
    finally { setSavingProxy(false); }
  });
  useEffect(() => setProxyURL(preferences.proxyURL ?? ''), [preferences.proxyURL]);
  const runtime = runtimeStatus(state, engine);
  // 显示已安装内核的版本；尚未安装时显示将要安装的推荐版本。
  const runtimeVersion = state.runtimeVersion ?? engine.version;
  return <VStack className="settings-page" gap={6}>
    <header><h1>{t('@yovoice.settings.title')}</h1></header>
    <TabList value={tab} onChange={setTab} role="tablist" hasDivider>
      <Tab value="general" label={t('@yovoice.settings.tabGeneral')} panelId="general-panel" />
      <Tab value="hotkeys" label={t('@yovoice.hotkeys.title')} panelId="hotkeys-panel" />
      <Tab value="models" label={t('@yovoice.settings.tabModelLibrary')} panelId="models-panel" />
      <Tab value="engine" label={t('@yovoice.settings.tabEngine')} panelId="engine-panel" />
      {aiServiceHidden(state.preferences) ? null : <Tab value="ai" label={t('@yovoice.settings.tabAI')} panelId="ai-panel" />}
      {featureHidden(state.preferences, 'assistant') ? null : <Tab value="assistant" label={t('@yovoice.assistant.title')} panelId="assistant-panel" />}
      <Tab value="community" label={t('@yovoice.community.settings')} panelId="community-panel" />
      <Tab value="assets" label={t('@yovoice.nav.assets')} panelId="assets-panel" />
      <Tab value="logs" label={t('@yovoice.settings.tabLogs')} panelId="logs-panel" />
    </TabList>
    {tab === 'general' ? <VStack className="settings-panel" gap={6} id="general-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabGeneral')}>
      <UpdateSettings />
      <AppearanceSettings state={state} run={run} />
      <SettingsGroup title={t('@yovoice.settings.preferences')}>
        <SettingsRow label={t('@yovoice.settings.uiLocale')}>
          <Selector data-testid="ui-locale" size="sm" label={t('@yovoice.settings.uiLocale')} isLabelHidden value={preferences.uiLocale}
            options={uiLocales.map(locale => ({ value: locale.id, label: locale.name }))}
            onChange={uiLocale => run(() => call('preferences.save', { ...preferences, uiLocale: uiLocale as UiLocale }))} width="calc(var(--spacing-10) * 5)" />
        </SettingsRow>
        <SettingsRow label={t('@yovoice.settings.proxy')} hint={t('@yovoice.settings.proxyHint')}>
          <TextInput size="sm" label={t('@yovoice.settings.proxyAddress')} isLabelHidden value={proxyURL} onChange={setProxyURL} onBlur={event => {
            // 点击开关时由开关一起保存地址，避免失焦保存抢先禁用开关。
            if (event.relatedTarget?.getAttribute('role') === 'switch') return;
            if (proxyURL.trim() !== (preferences.proxyURL ?? '')) saveProxy(proxyEnabled && !!proxyURL.trim());
          }} placeholder="http://127.0.0.1:7890" isDisabled={savingProxy} width="calc(var(--spacing-10) * 6)" />
          <Switch label={t('@yovoice.settings.proxyEnabled')} isLabelHidden value={proxyEnabled} isLoading={savingProxy} isDisabled={savingProxy || (!proxyEnabled && !proxyURL.trim())} onChange={enabled => saveProxy(enabled)} />
        </SettingsRow>
        <SettingsRow label={t('@yovoice.settings.intro')}>
          <Button size="sm" label={t('@yovoice.settings.introReplay')} onClick={() => window.dispatchEvent(new Event('workbench-show-intro'))} />
        </SettingsRow>
        <SettingsRow label={t('@yovoice.settings.guide')}>
          <Button size="sm" label={t('@yovoice.settings.guideReplay')} onClick={() => window.dispatchEvent(new Event('workbench-show-tour'))} />
        </SettingsRow>
      </SettingsGroup>
      <FeatureSettings state={state} run={run} />
      {featureHidden(state.preferences, 'transcribe') ? null : <TranscribeSettings state={state} run={run} />}
      <StorageSettings state={state} run={run} busy={busy || modelBusy} />
      <LocalAPISettings run={run} />
      <SettingsGroup title={t('@yovoice.settings.diagnosticsGroup')}>
        <SettingsRow label={t('@yovoice.settings.diagnostics')} hint={t('@yovoice.settings.diagnosticsHint')}>
          <Button size="sm" label={t('@yovoice.settings.viewLogs')} onClick={() => setTab('logs')} />
          <Button size="sm" label={t('@yovoice.settings.openLogs')} icon={<ArrowUpRight size={15} />} onClick={() => run(() => call('logs.open'))} />
        </SettingsRow>
      </SettingsGroup>
    </VStack> : tab === 'models' ? <VStack className="settings-panel" gap={6} id="models-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabModelLibrary')}>
      <SettingsGroup title={t('@yovoice.settings.downloads')}>
        <SettingsRow label={t('@yovoice.settings.downloadSource')}>
          <Selector size="sm" label={t('@yovoice.settings.downloadSource')} isLabelHidden value={preferences.downloadSource} options={[{ value: 'modelscope', label: t('@yovoice.settings.source.modelscope') }, { value: 'huggingface', label: t('@yovoice.settings.source.huggingface') }, { value: 'mirror', label: t('@yovoice.settings.source.mirror') }]} onChange={downloadSource => run(() => call('preferences.save', { ...preferences, downloadSource }))} width="calc(var(--spacing-10) * 5)" className="download-source" />
        </SettingsRow>
        <SettingsRow className="settings-directory" label={t('@yovoice.settings.modelDirectory')} hint={<Text type="inherit" color="inherit" className="model-path" onPointerEnter={overflowTitle}>{preferences.modelDirectory ?? t('@yovoice.settings.defaultDirectory')}</Text>}>
          <Button size="sm" label={t('@yovoice.settings.changeLocation')} icon={<FolderCog size={16} />} isDisabled={modelBusy || recoveringModels} onClick={() => run(() => call('model.directory'))} />
          <Button size="sm" label={t('@yovoice.settings.openFolder')} icon={<FolderOpen size={16} />} onClick={() => run(() => call('model.directory.open'))} />
        </SettingsRow>
        <SettingsRow label={t('@yovoice.settings.localSources')}>
          <LocalModelSources catalog={catalog} busy={busy || modelBusy} />
        </SettingsRow>
      </SettingsGroup>
      <TabList className="model-kinds" size="sm" value={shownKind} onChange={value => setKind(value as ModelKind)} role="tablist">
        {(['voice-models', 'music-models', 'soundfonts', 'asr-models'] as const).filter(value => !musicHidden || (value !== 'music-models' && value !== 'soundfonts'))
          .map(value => <Tab key={value} value={value} label={kindLabel[value]} panelId={`${value}-panel`} />)}
      </TabList>
      <VStack gap={6} id={`${shownKind}-panel`} role="tabpanel" aria-label={kindLabel[shownKind]}>
        {shownKind === 'asr-models' && recognizers.length > 1 ? <SettingsGroup>
          <SettingsRow label={t('@yovoice.settings.recognizeModel')} hint={t('@yovoice.settings.recognizeModelHint')}>
            <Selector size="sm" label={t('@yovoice.settings.recognizeModel')} isLabelHidden value={recognizer.id} options={recognizers.map(model => ({ value: model.id, label: `${model.name} · ${model.precision}` }))}
              onChange={recognizeModel => run(() => call('preferences.save', { ...preferences, recognizeModel }))} width="calc(var(--spacing-10) * 6)" />
          </SettingsRow>
        </SettingsGroup> : null}
        <ModelGroups key={shownKind} models={catalog.filter(model => modelTab(model.family) === shownKind)} state={state} draft={draft} run={run} focus={focus?.modelId} />
      </VStack>
      {shownKind === 'soundfonts' ? null : <HStack className="settings-footnote" gap={3} vAlign="center" wrap="wrap"><small>{t('@yovoice.settings.licenseBlurb')}</small><Button size="sm" label={t('@yovoice.settings.licenseButton')} variant="ghost" onClick={() => run(async () => { const response = await fetch('./model-license.txt'); if (!response.ok) throw new CallError('@yovoice.error.licenseReadFailed'); setLicense(await response.text()); })} /></HStack>}
    </VStack> : tab === 'hotkeys' ? <HotkeySettings state={state} run={run} active={active} /> : tab === 'ai' ? <AISettings state={state} run={run} focus={focus} /> : tab === 'assistant' ? <AssistantSettings state={state} run={run} /> : tab === 'community' ? <CommunitySettings state={state} run={run} /> : tab === 'assets'
      ? <Suspense fallback={<p role="status">{t('@yovoice.app.loading')}</p>}><AssetsPage state={state} active={active} run={run} onError={onError} openProject={openProject} /></Suspense> : tab === 'logs' ? <LogViewer run={run} /> : <VStack className="settings-panel engine-settings" gap={6} id="engine-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabEngine')}>
      <SettingsGroup title={<>audio.cpp{runtimeVersion ? <small className="model-size">{runtimeVersion}</small> : null}</>}>
        <SettingsRow className="engine-setting-row" label={t('@yovoice.settings.computeDevice')}>
          <Selector size="sm" label={t('@yovoice.settings.computeDevice')} isLabelHidden value={preferences.backend} options={[{ value: 'cpu', label: 'CPU' }, ...(isMac ? [{ value: 'metal', label: 'Apple GPU · Metal' }] : [...(isLinux ? [] : [{ value: 'cuda', label: 'NVIDIA GPU · CUDA 12.4' }, { value: 'cuda13', label: 'NVIDIA GPU · CUDA 13.3' }]), { value: 'vulkan', label: t('@yovoice.settings.backend.vulkan') }])]} onChange={backend => run(() => call('preferences.save', { ...preferences, backend }))} width="calc(var(--spacing-10) * 6)" className="compute-device" />
        </SettingsRow>
        {preferences.backend === 'cuda' || preferences.backend === 'cuda13' ? <SettingsRow className="engine-setting-row" label={t('@yovoice.settings.performanceFirst')} hint={t('@yovoice.settings.performanceFirstHint')}>
          <Switch size="sm" label={t('@yovoice.settings.performanceFirst')} isLabelHidden htmlName="performanceFirst" value={preferences.performanceFirst ?? false} onChange={performanceFirst => run(() => call('preferences.save', { ...preferences, performanceFirst }))} />
        </SettingsRow> : null}
        <SettingsRow className="engine-setting-row" label={t('@yovoice.settings.runtime')} hint={runtime === 'ready' ? t('@yovoice.settings.runtimeReady') : runtime === 'upgradable' ? t('@yovoice.settings.runtimeUpgradable', { version: engine.version }) : runtime === 'outdated' ? t('@yovoice.settings.runtimeOutdated', { version: engine.minimum }) : t('@yovoice.settings.runtimeMissing')}>
          <Button size="sm" label={runtime === 'ready' ? t('@yovoice.settings.reinstallRuntime') : runtime === 'missing' ? t('@yovoice.settings.installRuntime') : t('@yovoice.settings.updateRuntime', { version: engine.version })} isDisabled={busy} onClick={() => run(() => call('runtime.install'))} />
        </SettingsRow>
      </SettingsGroup>
      {runtime !== 'missing' ? <EngineRuntimeSettings state={state} catalog={catalog} run={run} /> : null}
    </VStack>}

    {license ? <AppDialog title={t('@yovoice.settings.licenseTitle')} width={680} onClose={() => setLicense(null)} actions={<Button label={t('@yovoice.settings.closeLicense')} onClick={() => setLicense(null)} />}><pre className="license-text">{license}</pre></AppDialog> : null}
  </VStack>;
}
