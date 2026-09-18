import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import definitions from '../../shared/lib/generation_options.json';
import type { Draft } from '../../shared/workbench';

export function ModelOptions({ draft, family, change }: { draft: Draft; family: keyof typeof definitions; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  const values = draft.modelOptions?.[family] ?? {};
  const update = (key: string, value: string | number | boolean) => change({ modelOptions: { ...draft.modelOptions, [family]: { ...values, [key]: value } } });
  return <VStack gap={4}>{definitions[family].map(spec => {
    const label = t(`@yovoice.options.${spec.key}`);
    const value = values[spec.key] ?? spec.default;
    if (spec.type === 'boolean') return <Switch key={spec.key} label={label} size="sm" value={Boolean(value)} onChange={value => update(spec.key, value)} />;
    if ('values' in spec && spec.values) return <Selector key={spec.key} label={label} value={String(value)} options={spec.values.map(value => ({ value, label: t(`@yovoice.options.value.${value}`) }))} onChange={value => update(spec.key, value)} />;
    if ('min' in spec) return <label key={spec.key} className="number-field">{label}<input type="number" min={spec.min} max={spec.max} step={spec.step} value={Number(value)} onChange={event => { if (event.target.value !== '') update(spec.key, Number(event.target.value)); }} /></label>;
    return null;
  })}</VStack>;
}
