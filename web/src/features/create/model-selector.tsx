import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector, SelectorOption } from '../../shared/selector';
import { formatBytes, groupModels, type ModelPackage, type State } from '../../shared/workbench';

// 可选模型：只列已下载的，当前选中但未下载的也保留；一个都没下载时列出全部，方便首次选择后去下载。
export function modelChoices(models: ModelPackage[], state: State, current: string) {
  const installed = models.filter(model => state.models.some(item => item.id === model.id));
  if (!installed.length) return models;
  const selected = models.find(model => model.id === current);
  return selected && !installed.includes(selected) ? [selected, ...installed] : installed;
}

// 配音、音乐、编曲共用的模型选择器：同一模型的多种量化只列一项，已下载多个精度时在下方切换精度；末尾是“管理模型…”。
export function ModelSelector({ label, models, state, value, isDisabled, manage, onChange, name = model => model.name }: {
  label: string; models: ModelPackage[]; state: State; value: string; isDisabled?: boolean;
  manage?: () => void; onChange: (modelId: string) => void; name?: (model: ModelPackage) => string;
}) {
  const t = useTranslator();
  const installed = (model: ModelPackage) => state.models.some(item => item.id === model.id);
  const groups = groupModels(modelChoices(models, state, value));
  // 每组用当前选中的精度，否则用目录里排在前面的那个。
  const options = groups.map(group => {
    const model = group.find(item => item.id === value) ?? group[0];
    const status = group.length > 1 ? group.map(item => item.precision).join(' · ') : `${model.precision} · ${installed(model) ? t('@yovoice.create.modelInstalled') : formatBytes(model.size)}`;
    return { value: model.id, label: name(model), description: status };
  });
  const current = groups.find(group => group.some(item => item.id === value));
  return <VStack gap={2}>
    <Selector label={label} isLabelHidden width="100%" className="model-selector" value={value} isDisabled={isDisabled}
      renderOption={option => <SelectorOption label={option.label} description={option.description} layout="inline" />} renderValue={option => { const model = models.find(item => item.id === option.value); return model && model.family !== 'soundfont' ? `${option.label} · ${model.precision}` : option.label; }}
      options={[...options, ...(manage ? [{ value: 'manage', label: t('@yovoice.create.manageModels') }] : [])]}
      onChange={modelId => { if (modelId === 'manage') manage?.(); else onChange(modelId); }} />
    {current && current.length > 1 ? <SegmentedControl size="sm" layout="fill" label={t('@yovoice.create.precision')} value={value} isDisabled={isDisabled} onChange={onChange}>
      {current.map(model => <SegmentedControlItem key={model.id} value={model.id} label={model.precision} />)}
    </SegmentedControl> : null}
  </VStack>;
}
