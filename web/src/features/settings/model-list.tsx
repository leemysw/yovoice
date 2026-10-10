import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Download, FilePlus, Pause, Trash2 } from 'lucide-react';
import { call } from '../../shared/lib/client';
import { formatSize, type Draft, type ModelPackage, type State } from '../../shared/workbench';
import { SettingsGroup } from './settings-group';

function downloadStatusLabel(t: (key: string) => string, downloading: boolean, received: number, size: number, status: string) {
  if (downloading) return received >= size ? t('@yovoice.settings.download.verifying') : t('@yovoice.settings.download.running');
  if (status === 'failed') return t('@yovoice.settings.download.failed');
  return t('@yovoice.settings.download.paused');
}

function modelDescription(t: (key: string) => string, model: ModelPackage) {
  if (model.family === 'soundfont') return t('@yovoice.settings.modelDesc.soundfont');
  if (model.family === 'ace_step') return t('@yovoice.settings.modelDesc.music');
  if (model.family === 'kokoro_tts') return t(model.id === 'kokoro-82m-q8' ? '@yovoice.settings.modelDesc.kokoroOfficial' : '@yovoice.settings.modelDesc.kokoro');
  if (model.family === 'omnivoice') return t('@yovoice.settings.modelDesc.omni');
  if (model.family === 'qwen3_tts') return t(`@yovoice.settings.modelDesc.qwen.${model.variant || 'base'}`);
  if (model.family === 'voxcpm2') return t('@yovoice.settings.modelDesc.vox');
  return model.version === '2.5' ? t('@yovoice.settings.modelDesc.25') : t('@yovoice.settings.modelDesc.basic');
}

// 模型与音色库共用：已下载的单独一组排在前面，带状态点；其余放在“可下载”组里。
export function ModelGroups({ models, state, draft, run }: { models: ModelPackage[]; state: State; draft: Draft; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const busy = state.activity?.status === 'running';
  const installed = models.filter(model => state.models.some(m => m.id === model.id));
  const available = models.filter(model => !installed.includes(model));
  const row = (model: ModelPackage) => {
    const ready = installed.includes(model);
    const activity = state.activity;
    const download = activity?.kind === 'download' && (activity.modelId === model.id || (!activity.modelId && activity.total === model.size)) && activity.status !== 'completed' ? activity : null;
    const downloading = download?.status === 'running';
    const removeBlocked = busy && !(activity?.kind === 'download' && activity.modelId && activity.modelId !== model.id);
    const inUse = draft.modelId === model.id;
    return <VStack className="model-row settings-row" data-model-id={model.id} data-installed={ready} key={model.id} gap={3}>
      <HStack className="model-summary" gap={4} vAlign="center" wrap="wrap">
        <VStack className="grow" gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {ready ? <StatusDot variant={inUse ? 'accent' : 'success'} label={inUse ? t('@yovoice.settings.inUse') : t('@yovoice.settings.verified')} /> : null}
            <p className="settings-row-title">{model.name}</p>
            <small className="precision">{model.precision}</small>
            <small className="model-size">{formatSize(model.size)}</small>
            {ready ? <small className="ready">{inUse ? t('@yovoice.settings.inUse') : t('@yovoice.settings.verified')}</small> : null}
          </HStack>
          <small>{modelDescription(t, model)}</small>
        </VStack>
        {downloading ? <Button size="sm" label={t('@yovoice.action.pause')} icon={<Pause size={16} />} onClick={() => run(() => call('operation.cancel'))} />
          : ready ? <Button size="sm" variant="ghost" label={t('@yovoice.settings.removeModel')} icon={<Trash2 size={16} />} isDisabled={removeBlocked} tooltip={removeBlocked ? t('@yovoice.settings.removeBlocked') : t('@yovoice.settings.removeTooltip')} onClick={() => run(() => call('model.forget', { id: model.id }))} />
          : !model.remotePath ? <Button size="sm" label={t('@yovoice.settings.importGguf')} icon={<FilePlus size={16} />} isDisabled={busy} onClick={() => run(() => call('model.import'))} />
          : <Button size="sm" label={download ? t('@yovoice.settings.resumeDownload') : t('@yovoice.settings.downloadModel')} icon={<Download size={16} />} isDisabled={busy} onClick={() => run(() => call('model.download', { id: model.id }))} />}
      </HStack>
      {download ? <VStack className="model-download" gap={2} role="status" aria-label={t('@yovoice.settings.downloadProgress', { name: model.name, precision: model.precision })}>
        <HStack hAlign="between" gap={3}><small>{downloadStatusLabel(t, !!downloading, download.received, model.size, download.status)}</small><small className="model-size">{formatSize(download.received)} / {formatSize(model.size)}</small></HStack>
        <progress aria-label={t('@yovoice.settings.downloadProgress', { name: model.name, precision: model.precision })} value={download.received} max={model.size} />
      </VStack> : null}
    </VStack>;
  };
  return <>
    {installed.length ? <SettingsGroup title={`${t('@yovoice.settings.downloaded')} · ${installed.length}`} className="model-list">{installed.map(row)}</SettingsGroup> : null}
    {available.length ? <SettingsGroup title={t('@yovoice.settings.available')} className="model-list available">{available.map(row)}</SettingsGroup> : null}
  </>;
}
