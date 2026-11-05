import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import { call } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatNotice } from '../../shared/i18n/format';
import type { Draft, RuntimeSettings, State } from '../../shared/workbench';
import definitions from '@internal/catalog/runtime_options.json';

type Value = string | number | boolean;
type Option = { key: string; type: string; default?: Value; min?: number; max?: number; step?: number; values?: string[] };
const options = definitions as Record<string, Option[]>;

export function RuntimeControls({ draft, state, family, change }: { draft: Draft; state: State; family: string; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  const [notice, setNotice] = useState('');
  const [unloading, setUnloading] = useState(false);
  if (!options[family]) return null;
  const settings = draft.runtime ?? {};
  const session = settings.session ?? {};
  const supported = state.runtimeSessionOptions?.[family] ?? [];
  const streaming = state.runtimeModes?.[family]?.includes('streaming') ?? false;
  const unavailable = Object.keys(session).filter(key => key.startsWith(`${family}.`) && !supported.includes(key));
  if (settings.streaming && !streaming) unavailable.push('streaming');
  const update = (patch: Partial<RuntimeSettings>) => change({ runtime: { ...settings, ...patch } });
  const updateSession = (key: string, value?: Value) => {
    const next = { ...session };
    if (value === undefined) delete next[key]; else next[key] = value;
    update({ session: next });
  };
  return <details className="advanced" data-testid="runtime-controls">
    <summary>{t('@yovoice.runtime.title')}</summary>
    <VStack gap={4} paddingBlockStart={4}>
      <small>{t('@yovoice.runtime.help')}</small>
      {unavailable.length ? <small role="alert">{t('@yovoice.error.modelOptionUnsupported', { name: unavailable.join(' · ') })}</small> : null}
      <Switch label={t('@yovoice.runtime.streaming')} value={!!settings.streaming} isDisabled={!streaming && !settings.streaming} description={t('@yovoice.runtime.streamingHelp')} onChange={value => {
        if (value && family === 'voxcpm2') change({ runtime: { ...settings, streaming: true }, modelOptions: { ...draft.modelOptions, voxcpm2: { ...draft.modelOptions?.voxcpm2, retry_badcase: false } } });
        else update({ streaming: value });
      }} />
      {!streaming ? <small>{t('@yovoice.runtime.streamingUnsupported')}</small> : null}
      {family === 'voxcpm2' && settings.streaming ? <small>{t('@yovoice.runtime.retryHelp')}</small> : null}
      <label className="number-field">{t('@yovoice.runtime.threads')}<input type="number" min={0} max={256} step={1} value={settings.threads ?? 0} onChange={event => update({ threads: Number(event.target.value) })} /></label>
      {state.preferences.backend !== 'cpu' ? <label className="number-field">{t('@yovoice.runtime.device')}<input type="number" min={0} max={255} step={1} value={settings.device ?? 0} onChange={event => update({ device: Number(event.target.value) })} /></label> : null}
      <label className="number-field">{t('@yovoice.runtime.idle')}<input type="number" min={0} max={86400} step={1} value={settings.idleUnloadSeconds ?? 300} onChange={event => update({ idleUnloadSeconds: Number(event.target.value) })} /></label>
      {options[family].filter(spec => supported.includes(spec.key)).map(spec => {
        const value = session[spec.key] ?? spec.default;
        if (spec.type === 'boolean') return <Switch key={spec.key} label={spec.key} value={Boolean(value)} onChange={value => updateSession(spec.key, value)} />;
        if (spec.type === 'select') return <Selector key={spec.key} label={spec.key} value={String(value ?? 'native')} options={(spec.values ?? []).map(value => ({ value, label: value }))} onChange={value => updateSession(spec.key, value)} />;
        if (spec.type === 'json') return <TextArea key={spec.key} label={spec.key} value={String(value ?? '')} rows={3} maxLength={10000} onChange={value => updateSession(spec.key, value || undefined)} />;
        if (spec.type === 'path') return <TextInput key={spec.key} label={spec.key} value={String(value ?? '')} onChange={value => updateSession(spec.key, value.slice(0, 4096) || undefined)} />;
        return <label key={spec.key} className="number-field">{spec.key}<input type="number" min={spec.min} max={spec.max} step={spec.step} placeholder={t('@yovoice.reference.auto')} value={typeof value === 'number' ? value : ''} onChange={event => updateSession(spec.key, event.target.value === '' ? undefined : Number(event.target.value))} /></label>;
      })}
      <HStack gap={2} wrap="wrap">
        <Button size="sm" label={t('@yovoice.runtime.reset')} onClick={() => change({ runtime: undefined })} />
        <Button size="sm" label={t('@yovoice.runtime.unload')} isLoading={unloading} isDisabled={state.activity?.status === 'running' || unloading} onClick={() => {
          setUnloading(true); setNotice('');
          void call('runtime.unload').then(() => setNotice('@yovoice.runtime.unloaded'), error => setNotice(noticeMessage(error))).finally(() => setUnloading(false));
        }} />
      </HStack>
      {notice ? <small role="status">{formatNotice(t, notice)}</small> : null}
    </VStack>
  </details>;
}
