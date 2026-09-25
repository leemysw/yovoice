import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Selector } from '../../shared/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Download, FolderOpen, FolderCog, FilePlus, Check, Cpu, ArrowUpRight, ChevronRight, Pause, Trash2 } from 'lucide-react';
import { call, isMac } from '../../shared/lib/client';
import { formatSize, type ModelPackage, type State, type Draft, type UiLocale } from '../../shared/workbench';
import { CallError } from '../../shared/lib/callError';

function downloadStatusLabel(t: (key: string) => string, downloading: boolean, received: number, size: number, status: string) {
  if (downloading) return received >= size ? t('@yovoice.settings.download.verifying') : t('@yovoice.settings.download.running');
  if (status === 'failed') return t('@yovoice.settings.download.failed');
  return t('@yovoice.settings.download.paused');
}

export function Settings({ state, catalog, draft, run }: { state: State; catalog: ModelPackage[]; draft: Draft; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const [license, setLicense] = useState<string | null>(null);
  const [tab, setTab] = useState('general'); const busy = state.activity?.status === 'running';
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
  const runtimeReady = !!state.runtimePath && state.runtimeBackend === preferences.backend;
  return <VStack className="settings-page" gap={6}>
    <header><h1>{t('@yovoice.settings.title')}</h1></header>
    <TabList value={tab} onChange={setTab} role="tablist" hasDivider><Tab value="general" label={t('@yovoice.settings.tabGeneral')} panelId="general-panel" /><Tab value="models" label={t('@yovoice.settings.tabModels')} panelId="models-panel" /><Tab value="engine" label={t('@yovoice.settings.tabEngine')} panelId="engine-panel" /></TabList>
    {tab === 'general' ? <VStack gap={5} id="general-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabGeneral')}>
      <HStack hAlign="between" vAlign="center" gap={4} wrap="wrap">
        <h3>{t('@yovoice.settings.uiLocale')}</h3>
        <Selector
          data-testid="ui-locale"
          size="sm"
          placement="below"
          label={t('@yovoice.settings.uiLocale')}
          isLabelHidden
          value={preferences.uiLocale}
          options={[
            { value: 'zh-CN', label: t('@yovoice.settings.uiLocale.zhCN') },
            { value: 'en', label: t('@yovoice.settings.uiLocale.en') },
          ]}
          onChange={uiLocale => run(() => call('preferences.save', { ...preferences, uiLocale: uiLocale as UiLocale }))}
          width="min(100%, calc(var(--spacing-10) * 5))"
        />
      </HStack>
      <VStack gap={3}>
        <h3>{t('@yovoice.settings.proxy')}</h3>
        <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
          <TextInput size="sm" label={t('@yovoice.settings.proxyAddress')} isLabelHidden value={proxyURL} onChange={setProxyURL} onBlur={event => {
            // 点击开关时由开关一起保存地址，避免失焦保存抢先禁用开关。
            if (event.relatedTarget?.getAttribute('role') === 'switch') return;
            if (proxyURL.trim() !== (preferences.proxyURL ?? '')) saveProxy(proxyEnabled && !!proxyURL.trim());
          }} placeholder="http://127.0.0.1:7890" isDisabled={savingProxy} width="min(100%, calc(var(--spacing-10) * 10))" />
          <Switch label={t('@yovoice.settings.proxyEnabled')} value={proxyEnabled} isLoading={savingProxy} isDisabled={savingProxy || (!proxyEnabled && !proxyURL.trim())} onChange={enabled => saveProxy(enabled)} />
        </HStack>
      </VStack>
    </VStack> : tab === 'models' ? <VStack gap={5} id="models-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabModels')}>
      <HStack className="settings-toolbar" hAlign="between" vAlign="center" gap={4} wrap="wrap">
        <HStack gap={3} vAlign="center" wrap="wrap">
          <p className="muted">{t('@yovoice.settings.downloadSource')}</p>
          <Selector size="sm" placement="below" label={t('@yovoice.settings.downloadSource')} isLabelHidden value={preferences.downloadSource} options={[{ value: 'modelscope', label: t('@yovoice.settings.source.modelscope') }, { value: 'huggingface', label: t('@yovoice.settings.source.huggingface') }, { value: 'mirror', label: t('@yovoice.settings.source.mirror') }]} onChange={downloadSource => run(() => call('preferences.save', { ...preferences, downloadSource }))} width="calc(var(--spacing-10) * 6)" className="download-source" />
        </HStack>
        <HStack gap={2}><Button size="sm" label={t('@yovoice.settings.importGguf')} icon={<FilePlus size={16} />} isDisabled={busy} onClick={() => run(() => call('model.import'))} /></HStack>
      </HStack>
      <HStack className="settings-directory" hAlign="between" gap={4} vAlign="center"><HStack className="grow" gap={3} vAlign="center"><p className="muted">{t('@yovoice.settings.modelDirectory')}</p><small className="model-path grow" title={preferences.modelDirectory ?? t('@yovoice.settings.defaultDirectory')}>{preferences.modelDirectory ?? t('@yovoice.settings.defaultDirectory')}</small></HStack><HStack className="directory-actions" gap={2}><Button size="sm" label={t('@yovoice.settings.changeLocation')} icon={<FolderCog size={16} />} isDisabled={busy} onClick={() => run(() => call('model.directory'))} /><Button size="sm" label={t('@yovoice.settings.openFolder')} icon={<FolderOpen size={16} />} onClick={() => run(() => call('model.directory.open'))} /></HStack></HStack>
      <section className="model-list">{catalog.map(model => {
        const installed = state.models.find(m => m.id === model.id);
        const activity = state.activity;
        const download = activity?.kind === 'download' && (activity.modelId === model.id || (!activity.modelId && activity.total === model.size)) && activity.status !== 'completed' ? activity : null;
        const downloading = download?.status === 'running';
        const removeBlocked = busy && !(activity?.kind === 'download' && activity.modelId && activity.modelId !== model.id);
        const modelDesc = model.family === 'kokoro_tts' ? t('@yovoice.settings.modelDesc.kokoro') : model.family === 'omnivoice' ? t('@yovoice.settings.modelDesc.omni') : model.family === 'qwen3_tts' ? t(`@yovoice.settings.modelDesc.qwen.${model.variant || 'base'}`) : model.family === 'voxcpm2' ? t('@yovoice.settings.modelDesc.vox') : model.version === '2.5' ? t('@yovoice.settings.modelDesc.25') : t('@yovoice.settings.modelDesc.basic');
        return <VStack className="model-row" key={model.id} gap={3}><HStack className="model-summary" gap={5} vAlign="center" wrap="wrap">
          <VStack className="grow" gap={1}><HStack gap={3} vAlign="center" wrap="wrap"><h3>{model.name}</h3><small className="precision">{model.precision}</small><small className="model-size">{formatSize(model.size)}</small>{installed ? <small className="ready"><Check size={12} />{draft.modelId === model.id ? t('@yovoice.settings.inUse') : t('@yovoice.settings.verified')}</small> : null}</HStack><small>{modelDesc}</small></VStack>
          {downloading ? <Button size="sm" label={t('@yovoice.action.pause')} icon={<Pause size={16} />} onClick={() => run(() => call('operation.cancel'))} /> : installed ? <Button size="sm" label={t('@yovoice.settings.removeModel')} icon={<Trash2 size={16} />} isDisabled={removeBlocked} tooltip={removeBlocked ? t('@yovoice.settings.removeBlocked') : t('@yovoice.settings.removeTooltip')} onClick={() => run(() => call('model.forget', { id: model.id }))} /> : !model.remotePath ? <Button size="sm" label={t('@yovoice.settings.importGguf')} icon={<FilePlus size={16} />} isDisabled={busy} onClick={() => run(() => call('model.import'))} /> : <Button size="sm" label={download ? t('@yovoice.settings.resumeDownload') : t('@yovoice.settings.downloadModel')} icon={<Download size={16} />} isDisabled={busy} onClick={() => run(() => call('model.download', { id: model.id }))} />}
        </HStack>
        {download ? <VStack className="model-download" gap={2} role="status" aria-label={t('@yovoice.settings.downloadProgress', { name: model.name, precision: model.precision })}>
          <HStack hAlign="between" gap={3}><small>{downloadStatusLabel(t, !!downloading, download.received, model.size, download.status)}</small><small>{formatSize(download.received)} / {formatSize(model.size)}</small></HStack>
          <progress aria-label={t('@yovoice.settings.downloadProgress', { name: model.name, precision: model.precision })} value={download.received} max={model.size} />
        </VStack> : null}
        </VStack>;
      })}</section>
      <details className="settings-help"><summary><ChevronRight size={16} aria-hidden="true" />{t('@yovoice.settings.modelHelpSummary')}</summary><p className="helper muted">{t('@yovoice.settings.modelHelpBody')}</p></details>
      <p className="helper muted">{t('@yovoice.settings.licenseBlurb')}<Button size="sm" label={t('@yovoice.settings.licenseButton')} variant="ghost" onClick={() => run(async () => { const response = await fetch('./model-license.txt'); if (!response.ok) throw new CallError('@yovoice.error.licenseReadFailed'); setLicense(await response.text()); })} /></p>
    </VStack> : <VStack className="engine-settings" gap={5} id="engine-panel" role="tabpanel" aria-label={t('@yovoice.settings.tabEngine')}>
      <HStack className="runtime-heading" gap={3} vAlign="center"><Cpu size={22} strokeWidth={1.5} /><h2>audio.cpp</h2><small>v0.7.4</small></HStack>
      <VStack gap={0}>
        <HStack className="engine-setting-row" hAlign="between" vAlign="center" gap={4} wrap="wrap"><h3>{t('@yovoice.settings.computeDevice')}</h3><Selector size="sm" placement="below" label={t('@yovoice.settings.computeDevice')} isLabelHidden value={preferences.backend} options={[{ value: 'cpu', label: 'CPU' }, ...(isMac ? [{ value: 'metal', label: 'Apple GPU · Metal' }] : [{ value: 'cuda', label: 'NVIDIA GPU · CUDA 12.4' }, { value: 'vulkan', label: t('@yovoice.settings.backend.vulkan') }])]} onChange={backend => run(() => call('preferences.save', { ...preferences, backend }))} isDisabled={busy} width="min(100%, calc(var(--spacing-10) * 6))" className="compute-device" /></HStack>
        <HStack className="engine-setting-row" hAlign="between" gap={4} vAlign="center" wrap="wrap"><VStack className="grow" gap={1}><h3>{t('@yovoice.settings.runtime')}</h3><small>{runtimeReady ? t('@yovoice.settings.runtimeReady') : t('@yovoice.settings.runtimeMissing')}</small></VStack><Button size="sm" label={runtimeReady ? t('@yovoice.settings.reinstallRuntime') : t('@yovoice.settings.installRuntime')} isDisabled={busy} onClick={() => run(() => call('runtime.install'))} /></HStack>
        <HStack className="engine-setting-row" hAlign="between" gap={4} vAlign="center"><h3>{t('@yovoice.settings.diagnostics')}</h3><Button size="sm" label={t('@yovoice.settings.openLogs')} icon={<ArrowUpRight size={15} />} variant="ghost" onClick={() => run(() => call('logs.open'))} /></HStack>
      </VStack>
      <details className="settings-help engine-help"><summary><ChevronRight size={15} aria-hidden="true" />{t('@yovoice.settings.engineHelpSummary')}</summary><VStack gap={2}><p className="helper">{isMac ? t('@yovoice.settings.engineHelpMac') : t('@yovoice.settings.engineHelpWin')}</p><p className="helper">{t('@yovoice.settings.engineHelpGpu')}</p></VStack></details>
    </VStack>}

    {license ? <Dialog isOpen onOpenChange={open => { if (!open) setLicense(null); }} width={680} padding={6}><VStack gap={4}><h2 tabIndex={-1} data-autofocus="">{t('@yovoice.settings.licenseTitle')}</h2><pre className="license-text">{license}</pre><Button size="sm" label={t('@yovoice.settings.closeLicense')} onClick={() => setLicense(null)} /></VStack></Dialog> : null}
  </VStack>;
}
