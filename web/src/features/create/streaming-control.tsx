import { VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import type { Draft, State } from '../../shared/workbench';
import generationOptions from '@internal/catalog/generation_options.json';
import { ModelOptions } from './model-options';

type Family = keyof typeof generationOptions;

// 边生成边试听：只在当前引擎为该模型提供流式输出时出现；打开后显示流式专用的分段参数。
// 线程、设备、空闲卸载与模型会话参数属于本机引擎，在设置 › 推理引擎里调整。
export function StreamingControl({ draft, state, family, change }: { draft: Draft; state: State; family: string; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  const streaming = !!draft.runtime?.streaming;
  if (!state.runtimeModes?.[family]?.includes('streaming') && !streaming) return null;
  const streamOnly = family in generationOptions && (generationOptions[family as Family] as { streamOnly?: boolean }[]).some(spec => spec.streamOnly);
  const toggle = (value: boolean) => {
    const runtime = value ? { streaming: true } : undefined;
    // VoxCPM2 的失败重试与流式输出互斥，打开流式时一并关闭。
    if (value && family === 'voxcpm2') change({ runtime, modelOptions: { ...draft.modelOptions, voxcpm2: { ...draft.modelOptions?.voxcpm2, retry_badcase: false } } });
    else change({ runtime });
  };
  return <VStack gap={3} data-testid="streaming-control">
    <Switch size="sm" label={t('@yovoice.runtime.streaming')} value={streaming} onChange={toggle} labelPosition="start" labelSpacing="spread" />
    {streaming && family === 'voxcpm2' ? <small className="streaming-note">{t('@yovoice.runtime.retryHelp')}</small> : null}
    {streaming && streamOnly ? <ModelOptions draft={draft} family={family as Family} change={change} streamOnly supported={state.runtimeOptions?.[family]} /> : null}
  </VStack>;
}
