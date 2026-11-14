import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { useTranslator } from '@astryxdesign/core/i18n';
import { CircleCheck, FolderOpen, Download, Pause, RefreshCw, Search, Trash2 } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { formatBytes, groupModels, modelMainFile, modelUpdateAvailable, modelVersionDigest, type Draft, type ModelPackage, type State } from '../../shared/workbench';
import { formatDateTime } from '../../shared/i18n/format';
import { Selector } from '../../shared/selector';
import { SettingsGroup } from '../../shared/ui/settings-group';
import { overflowTitle } from '../../shared/ui/overflow-title';

function downloadStatusLabel(t: (key: string) => string, downloading: boolean, received: number, size: number, status: string) {
  if (downloading) return received >= size ? t('@yovoice.settings.download.verifying') : t('@yovoice.settings.download.running');
  if (status === 'failed') return t('@yovoice.settings.download.failed');
  return t('@yovoice.settings.download.paused');
}

function modelDescription(t: (key: string) => string, model: ModelPackage) {
  if (model.family === 'soundfont') return t(({ 'generaluser-gs-sf2': '@yovoice.settings.modelDesc.soundfontGeneralUser', 'sgm-v2-sf2': '@yovoice.settings.modelDesc.soundfontSgm' } as Record<string, string>)[model.id] ?? '@yovoice.settings.modelDesc.soundfont');
  if (model.family === 'ace_step') return t('@yovoice.settings.modelDesc.music');
  if (model.family === 'yue2') return t('@yovoice.settings.modelDesc.yue2');
  if (model.family === 'stable_audio') return t(`@yovoice.settings.modelDesc.stableAudio.${model.variant || 'music'}`);
  if (model.family === 'sheetsage2') return t('@yovoice.settings.modelDesc.sheetsage2');
  if (model.family === 'lyric_align') return t('@yovoice.settings.modelDesc.lyricAlign');
  if (model.family === 'qwen3_asr') return t('@yovoice.settings.modelDesc.recognize');
  if (model.family === 'parakeet_tdt') return t('@yovoice.settings.modelDesc.parakeet');
  if (model.family === 'confucius4_r2t2') return t('@yovoice.settings.modelDesc.confucius');
  if (model.family === 'htdemucs_6stems') return t('@yovoice.settings.modelDesc.stems');
  if (model.family === 'bs_roformer') return t('@yovoice.settings.modelDesc.vocalSplit');
  if (model.family === 'muscriptor') return t('@yovoice.settings.modelDesc.muscriptor');
  if (model.family === 'kokoro_tts') return t(model.id === 'kokoro-82m-q8' ? '@yovoice.settings.modelDesc.kokoroOfficial' : '@yovoice.settings.modelDesc.kokoro');
  if (model.family === 'omnivoice') return t('@yovoice.settings.modelDesc.omni');
  if (model.family === 'qwen3_tts') return t(`@yovoice.settings.modelDesc.qwen.${model.variant || 'base'}`);
  if (model.family === 'voxcpm2') return t('@yovoice.settings.modelDesc.vox');
  if (model.family === 'breeze_tts') return t('@yovoice.settings.modelDesc.breeze');
  if (model.family === 'ming3_tts') return t('@yovoice.settings.modelDesc.ming');
  if (model.family === 'voxtral_tts') return t('@yovoice.settings.modelDesc.voxtral');
  if (model.family === 'plapre') return t('@yovoice.settings.modelDesc.plapre');
  if (model.family === 'xtts_v2') return t('@yovoice.settings.modelDesc.xtts');
  if (model.family === 'gradium_phonon') return t('@yovoice.settings.modelDesc.gradium');
  if (model.family === 'fish_drama3') return t('@yovoice.settings.modelDesc.drama');
  return model.version === '2.5' ? t('@yovoice.settings.modelDesc.25') : t('@yovoice.settings.modelDesc.basic');
}

// 模型与音色库共用：同一模型的各种量化合并为一行，用精度切换；有任一精度已下载的排在“已下载”组，其余放在“可下载”组。
export function ModelGroups({ models, state, draft, run, focus }: { models: ModelPackage[]; state: State; draft: Draft; run: (task: () => Promise<unknown>) => void; focus?: string }) {
  const t = useTranslator();
  // 生成等主操作与模型下载、导入互不阻塞：下载按钮只看模型安装是否空闲。
  const busy = state.activity?.status === 'running';
  const modelBusy = state.modelActivity?.status === 'running';
  const isInstalled = (model: ModelPackage) => state.models.some(m => m.id === model.id);
  const groups = groupModels(models);
  const installed = groups.filter(group => group.some(isInstalled));
  const available = groups.filter(group => !installed.includes(group));
  // 每组当前选中的精度。
  const [picks, setPicks] = useState<Record<string, string>>({});
  const activity = state.modelActivity;
  const downloadOf = (model: ModelPackage) => state.modelDownloads?.[model.id];
  const legacyDownload = activity?.kind === 'download' && activity.status !== 'completed' && activity.modelId
    && !state.modelDownloads?.[activity.modelId] ? activity : null;
  const activeDownload = activity?.kind === 'download' && activity.status === 'running' ? activity : null;
  const picked = (group: ModelPackage[]) => group.find(model => model.id === activeDownload?.modelId)
    ?? group.find(model => model.id === picks[group[0].name])
    ?? group.find(model => model.id === focus) ?? group.find(downloadOf) ?? group.find(model => model.id === legacyDownload?.modelId) ?? group.find(model => model.id === draft.modelId)
    ?? group.find(isInstalled) ?? group.find(model => model.precision === 'Q8') ?? group[0];
  // 可下载的模型较多时按名称、精度和用途搜索。
  const [query, setQuery] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = available.filter(group => group.some(model => downloadOf(model) || legacyDownload?.modelId === model.id) || group.some(model => { const text = `${model.name} ${model.precision} ${model.family} ${modelDescription(t, model)}`.toLowerCase(); return terms.every(term => text.includes(term)); }));
  const row = (group: ModelPackage[]) => {
    const model = picked(group);
    const ready = isInstalled(model);
    const download = downloadOf(model);
    const legacy = legacyDownload?.modelId === model.id ? legacyDownload : null;
    const live = activeDownload?.modelId === model.id ? activeDownload : null;
    const downloading = !!live;
    const received = live?.received ?? download?.received ?? legacy?.received ?? 0;
    const total = live?.total || download?.total || legacy?.total || model.size;
    const removeBlocked = busy || (modelBusy && !(activity?.kind === 'download' && activity.modelId && activity.modelId !== model.id));
    const inUse = draft.modelId === model.id;
    const owned = group.filter(isInstalled);
    const update = modelUpdateAvailable(state, model);
    // 应用下载的模型移除时连同文件删除；导入的模型只解除登记。
    const record = state.models.find(m => m.id === model.id);
    const managed = record?.managed ?? false;
    // 目录更新替换过的模型可以换回旧版本；已安装文件不属于任何已知版本（如自行转换的导入文件）时不显示。
    const latest = modelMainFile(model).sha256;
    const versions = model.history?.length ? [{ value: latest, label: t('@yovoice.settings.modelVersionLatest') },
      ...model.history.map(version => ({ value: modelVersionDigest(model, version), label: t('@yovoice.settings.modelVersionBefore', { date: formatDateTime(version.replaced, state.preferences.uiLocale, 'date') }) }))] : [];
    const currentVersion = managed && !record?.converted && versions.some(version => version.value === record?.sha256) ? record?.sha256 : undefined;
    return <VStack className="model-row settings-row" data-model-id={model.id} data-model-ids={group.map(item => item.id).join(' ')} data-installed={ready} key={group[0].name} gap={3}>
      <HStack className="model-summary" gap={4} vAlign="center" wrap="wrap">
        <VStack className="grow" gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {owned.length ? <StatusDot variant={group.some(item => item.id === draft.modelId) ? 'accent' : 'success'} label={group.some(item => item.id === draft.modelId) ? t('@yovoice.settings.inUse') : t('@yovoice.settings.verified')} /> : null}
            <p className="settings-row-title">{model.name}</p>
            {group.length === 1 ? <small className="precision">{model.precision}</small> : null}
            <small className="model-size">{formatBytes(model.size)}</small>
            {update ? <Token size="sm" color="gray" label={t('@yovoice.settings.modelUpdateAvailable')} /> : null}
            {ready && !update ? <small className="ready">{inUse ? t('@yovoice.settings.inUse') : t('@yovoice.settings.verified')}</small> : null}
          </HStack>
          <small>{modelDescription(t, model)}</small>
        </VStack>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {/* 未下载的模型也可以导入本机已有的文件（原地使用），作为下载旁的次要操作。 */}
          {!ready && !download && !legacy && !downloading ? <Button size="sm" variant="ghost" isIconOnly label={t('@yovoice.settings.importLocalModel')} tooltip={t('@yovoice.settings.localModelHint')} icon={<FolderOpen size={16} />} isDisabled={busy || modelBusy} onClick={() => run(() => call('model.import', { id: model.id }))} /> : null}
          {downloading || download || legacy ? <>
            {downloading ? <Button size="sm" label={t('@yovoice.action.pause')} icon={<Pause size={16} />} onClick={() => run(() => call('model.pause', { id: model.id }))} />
              : download ? <Button size="sm" label={t('@yovoice.settings.resumeDownload')} icon={<Download size={16} />} isDisabled={modelBusy} onClick={() => run(() => call('model.download', { id: model.id }))} /> : null}
            <Button size="sm" variant="secondary" label={t('@yovoice.settings.cancelDownload')} onClick={() => run(() => call('model.cancel', { id: model.id }))} />
          </> : ready ? <HStack gap={1} vAlign="center">
            {currentVersion ? <Selector size="sm" className="model-version" label={t('@yovoice.settings.modelVersion')} isLabelHidden value={currentVersion} options={versions} isDisabled={busy || modelBusy}
              onChange={version => { if (version !== currentVersion) run(() => call('model.download', { id: model.id, version })); }} width="calc(var(--spacing-10) * 4)" /> : null}
            {update ? <Button size="sm" variant="secondary" label={t('@yovoice.settings.updateModel')}
              tooltip={`${t('@yovoice.settings.modelVersionLatest')} · ${latest.slice(0, 12)} · ${formatBytes(model.size)}`}
              icon={<RefreshCw size={16} />} isDisabled={modelBusy} onClick={() => run(() => call('model.download', { id: model.id }))} /> : null}
            <Button size="sm" variant="ghost" label={t('@yovoice.settings.removeModel')} icon={<Trash2 size={16} />} isDisabled={removeBlocked} tooltip={removeBlocked ? t('@yovoice.settings.removeBlocked') : t(managed ? '@yovoice.settings.removeManagedTooltip' : '@yovoice.settings.removeTooltip')} onClick={() => run(() => call('model.forget', { id: model.id }))} />
          </HStack> : <Button size="sm" label={t('@yovoice.settings.downloadModel')} icon={<Download size={16} />} isDisabled={modelBusy} onClick={() => run(() => call('model.download', { id: model.id }))} />}
        </HStack>
      </HStack>
      {ready && (!managed || record?.converted) ? <small className="model-path" title={record?.path}>{record?.path}</small> : null}
      {group.length > 1 ? <HStack className="model-precisions" gap={3} vAlign="center" wrap="wrap">
        <SegmentedControl size="sm" label={t('@yovoice.settings.precisionOf', { name: model.name })} value={model.id} onChange={id => setPicks(current => ({ ...current, [model.name]: id }))}>
          {group.map(item => <SegmentedControlItem onPointerEnter={overflowTitle} key={item.id} value={item.id} label={item.precision} icon={isInstalled(item) ? <CircleCheck /> : undefined} />)}
        </SegmentedControl>
        {owned.length ? <small>{t('@yovoice.settings.precisionsInstalled', { list: owned.map(item => item.precision).join(' · ') })}</small> : null}
      </HStack> : null}
      {download || downloading || legacy ? <VStack className="model-download" gap={2} role="status" aria-label={t('@yovoice.settings.downloadProgress', { name: model.name, precision: model.precision })}>
        {download ? <small>{versions.find(version => version.value === download.version)?.label
          ?? (download.version === latest ? t('@yovoice.settings.modelVersionLatest') : download.version.slice(0, 12))}</small> : null}
        <HStack hAlign="between" gap={3}><small>{downloadStatusLabel(t, downloading, received, total, download?.status ?? legacy?.status ?? 'running')}</small><small className="model-size">{formatBytes(received)} / {formatBytes(total)}</small></HStack>
        <ProgressBar label={t('@yovoice.settings.downloadProgress', { name: model.name, precision: model.precision })} isLabelHidden value={received} max={total || 1} isIndeterminate={downloading && !total} />
      </VStack> : null}
    </VStack>;
  };
  return <>
    {installed.length ? <SettingsGroup title={`${t('@yovoice.settings.downloaded')} · ${installed.length}`} className="model-list">{installed.map(row)}</SettingsGroup> : null}
    {available.length ? <SettingsGroup title={t('@yovoice.settings.available')} className="model-list available"
      actions={available.length > 5 ? <TextInput size="sm" className="model-search" label={t('@yovoice.settings.searchModels')} isLabelHidden startIcon={<Search />} placeholder={t('@yovoice.settings.searchModels')} value={query} onChange={setQuery} width="calc(var(--spacing-10) * 6)" /> : undefined}>
      {matches.length ? matches.map(row) : <p className="settings-row model-search-empty">{t('@yovoice.settings.noModelMatch')}</p>}
    </SettingsGroup> : null}
  </>;
}
