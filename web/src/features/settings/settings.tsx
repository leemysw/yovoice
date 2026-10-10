import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import { FolderOpen, FolderCog, FilePlus, ArrowUpRight } from 'lucide-react';
import { call, isMac } from '../../shared/lib/client';
import { runtimeStatus, type EngineInfo, type ModelPackage, type State, type Draft, type UiLocale } from '../../shared/workbench';
import { CallError } from '../../shared/lib/call-error';
import { AISettings } from './ai-settings';
import { ModelGroups } from './model-list';
import { SettingsGroup, SettingsRow } from './settings-group';

export function Settings({ state, catalog, engine, draft, run, focus }: { focus?: { tab: string; modelId: string; request: number }; state: State; catalog: ModelPackage[]; engine: EngineInfo; draft: Draft; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const [license, setLicense] = useState<string | null>(null);
  const [tab, setTab] = useState('general'); const busy = state.activity?.status === 'running';
  useEffect(() => { if (focus) setTab(focus.tab); }, [focus]);
  useEffect(() => {
    if (!focus || (tab !== 'models' && tab !== 'soundfonts')) return;
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-model-id]')).find(row => row.dataset.modelId === focus.modelId);
    row?.scrollIntoView({ block: 'nearest' });
  }, [focus, tab]);
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
      <Tab value="models" label={t('@yovoice.settings.tabModels')} panelId="models-panel" />
      <Tab value="soundfonts" label={t('@yovoice.settings.tabSoundfonts')} panelId="soundfonts-panel" />
      <Tab value="engine" label={t('@yovoice.settings.tabEngine')} panelId="engine-panel" />
      <Tab value="ai" label={t('@yovoice.settings.tabAI')} panelId="ai-panel" />
    </TabList>
    {tab === 'general' ? <VStack className="settings-panel" gap={6} id="general-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabGeneral')}>
      <SettingsGroup title={t('@yovoice.settings.preferences')}>
        <SettingsRow label={t('@yovoice.settings.uiLocale')} hint={t('@yovoice.settings.uiLocaleHint')}>
          <Selector data-testid="ui-locale" size="sm" label={t('@yovoice.settings.uiLocale')} isLabelHidden value={preferences.uiLocale}
            options={[{ value: 'zh-CN', label: t('@yovoice.settings.uiLocale.zhCN') }, { value: 'en', label: t('@yovoice.settings.uiLocale.en') }]}
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
      </SettingsGroup>
    </VStack> : tab === 'models' ? <VStack className="settings-panel" gap={6} id="models-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabModels')}>
      <SettingsGroup title={t('@yovoice.settings.downloads')}>
        <SettingsRow label={t('@yovoice.settings.downloadSource')}>
          <Selector size="sm" label={t('@yovoice.settings.downloadSource')} isLabelHidden value={preferences.downloadSource} options={[{ value: 'modelscope', label: t('@yovoice.settings.source.modelscope') }, { value: 'huggingface', label: t('@yovoice.settings.source.huggingface') }, { value: 'mirror', label: t('@yovoice.settings.source.mirror') }]} onChange={downloadSource => run(() => call('preferences.save', { ...preferences, downloadSource }))} width="calc(var(--spacing-10) * 5)" className="download-source" />
        </SettingsRow>
        <SettingsRow className="settings-directory" label={t('@yovoice.settings.modelDirectory')} hint={<span className="model-path" title={preferences.modelDirectory ?? t('@yovoice.settings.defaultDirectory')}>{preferences.modelDirectory ?? t('@yovoice.settings.defaultDirectory')}</span>}>
          <Button size="sm" label={t('@yovoice.settings.changeLocation')} icon={<FolderCog size={16} />} isDisabled={busy} onClick={() => run(() => call('model.directory'))} />
          <Button size="sm" label={t('@yovoice.settings.openFolder')} icon={<FolderOpen size={16} />} onClick={() => run(() => call('model.directory.open'))} />
        </SettingsRow>
        <SettingsRow label={t('@yovoice.settings.importLocal')} hint={t('@yovoice.settings.importLocalHint')}>
          <Button size="sm" label={t('@yovoice.settings.importGguf')} icon={<FilePlus size={16} />} isDisabled={busy} onClick={() => run(() => call('model.import'))} />
        </SettingsRow>
      </SettingsGroup>
      <ModelGroups models={catalog.filter(model => model.family !== 'soundfont')} state={state} draft={draft} run={run} />
      <HStack className="settings-footnote" gap={3} vAlign="center" wrap="wrap"><small>{t('@yovoice.settings.licenseBlurb')}</small><Button size="sm" label={t('@yovoice.settings.licenseButton')} variant="ghost" onClick={() => run(async () => { const response = await fetch('./model-license.txt'); if (!response.ok) throw new CallError('@yovoice.error.licenseReadFailed'); setLicense(await response.text()); })} /></HStack>
    </VStack> : tab === 'soundfonts' ? <VStack className="settings-panel" gap={6} id="soundfonts-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabSoundfonts')}>
      <small className="settings-intro">{t('@yovoice.settings.soundfontIntro')}</small>
      <ModelGroups models={catalog.filter(model => model.family === 'soundfont')} state={state} draft={draft} run={run} />
    </VStack> : tab === 'ai' ? <AISettings state={state} run={run} /> : <VStack className="settings-panel engine-settings" gap={6} id="engine-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabEngine')}>
      <SettingsGroup title={<>audio.cpp{runtimeVersion ? <small className="model-size">{runtimeVersion}</small> : null}</>}>
        <SettingsRow className="engine-setting-row" label={t('@yovoice.settings.computeDevice')}>
          <Selector size="sm" label={t('@yovoice.settings.computeDevice')} isLabelHidden value={preferences.backend} options={[{ value: 'cpu', label: 'CPU' }, ...(isMac ? [{ value: 'metal', label: 'Apple GPU · Metal' }] : [{ value: 'cuda', label: 'NVIDIA GPU · CUDA 12.4' }, { value: 'cuda13', label: 'NVIDIA GPU · CUDA 13.3' }, { value: 'vulkan', label: t('@yovoice.settings.backend.vulkan') }])]} onChange={backend => run(() => call('preferences.save', { ...preferences, backend }))} isDisabled={busy} width="calc(var(--spacing-10) * 6)" className="compute-device" />
        </SettingsRow>
        <SettingsRow className="engine-setting-row" label={t('@yovoice.settings.runtime')} hint={runtime === 'ready' ? t('@yovoice.settings.runtimeReady') : runtime === 'upgradable' ? t('@yovoice.settings.runtimeUpgradable', { version: engine.version }) : runtime === 'outdated' ? t('@yovoice.settings.runtimeOutdated', { version: engine.minimum }) : t('@yovoice.settings.runtimeMissing')}>
          <Button size="sm" label={runtime === 'ready' ? t('@yovoice.settings.reinstallRuntime') : runtime === 'missing' ? t('@yovoice.settings.installRuntime') : t('@yovoice.settings.updateRuntime', { version: engine.version })} isDisabled={busy} onClick={() => run(() => call('runtime.install'))} />
        </SettingsRow>
        <SettingsRow className="engine-setting-row" label={t('@yovoice.settings.diagnostics')}>
          <Button size="sm" label={t('@yovoice.settings.openLogs')} icon={<ArrowUpRight size={15} />} onClick={() => run(() => call('logs.open'))} />
        </SettingsRow>
      </SettingsGroup>
    </VStack>}

    {license ? <AppDialog title={t('@yovoice.settings.licenseTitle')} width={680} onClose={() => setLicense(null)} actions={<Button label={t('@yovoice.settings.closeLicense')} onClick={() => setLicense(null)} />}><pre className="license-text">{license}</pre></AppDialog> : null}
  </VStack>;
}
