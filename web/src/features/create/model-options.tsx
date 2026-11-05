import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '../../shared/selector';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import definitions from '@internal/catalog/generation_options.json';
import type { Draft } from '../../shared/workbench';

export function ModelOptions({ draft, family, change, omit = [], supported = [], streamOnly = false }: { draft: Draft; family: keyof typeof definitions; change: (patch: Partial<Draft>) => void; omit?: string[]; supported?: string[]; streamOnly?: boolean }) {
  const t = useTranslator();
  const values = draft.modelOptions?.[family] ?? {};
  const update = (key: string, value: string | number | boolean) => change({ modelOptions: { ...draft.modelOptions, [family]: { ...values, [key]: value } } });
  const available = (spec: typeof definitions[typeof family][number]) => (!('modelPrefix' in spec) || !spec.modelPrefix || draft.modelId.startsWith(spec.modelPrefix))
    && (!('requiresRuntime' in spec) || !spec.requiresRuntime || supported.includes(spec.key));
  const shown = definitions[family].filter(spec => Boolean('streamOnly' in spec && spec.streamOnly) === streamOnly);
  const unavailable = shown.filter(spec => spec.key in values && !available(spec));
  return <VStack gap={4}>
    {unavailable.length ? <HStack gap={2} wrap="wrap" vAlign="center">
      <small role="status">{t('@yovoice.error.modelOptionUnsupported', { name: unavailable.map(spec => t(`@yovoice.options.${spec.key}`)).join(' · ') })}</small>
      <Button size="sm" label={t('@yovoice.action.reset')} onClick={() => change({ modelOptions: { ...draft.modelOptions, [family]: Object.fromEntries(Object.entries(values).filter(([key]) => !unavailable.some(spec => spec.key === key))) } })} />
    </HStack> : null}
    {shown.filter(spec => !omit.includes(spec.key) && available(spec)).map(spec => {
    const label = t(`@yovoice.options.${spec.key}`);
    const value = values[spec.key] ?? spec.default;
    if (spec.type === 'boolean') return <Switch key={spec.key} label={label} size="sm" value={Boolean(value)} onChange={value => update(spec.key, value)} />;
    if ('values' in spec && spec.values) return <Selector key={spec.key} label={label} value={String(value)} options={spec.values.map(value => ({ value, label: t(`@yovoice.options.value.${value}`) }))} onChange={value => update(spec.key, value)} />;
    if ('min' in spec) return <label key={spec.key} className="number-field">{label}<input type="number" min={spec.min} max={spec.max} step={spec.step} value={Number(value)} onChange={event => { if (event.target.value !== '') update(spec.key, Number(event.target.value)); }} /></label>;
    return null;
  })}</VStack>;
}
