import { useCallback, useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { FolderOpen } from 'lucide-react';
import { Selector } from '../../shared/selector';
import { call } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import type { Adapter, Draft } from '../../shared/workbench';

// YuE2 的 LoRA：作曲（第一阶段）决定旋律与编排风格，音色（第二阶段）决定音质与人声质感。
// 文件导入后复制进数据目录，作品只记适配器 ID。
const parts = [{ key: 'ar', label: '@yovoice.lora.ar' }, { key: 'nar', label: '@yovoice.lora.nar' }] as const;

export function YueAdapters({ draft, change, disabled }: { draft: Draft; change: (patch: Partial<Draft>) => void; disabled?: boolean }) {
  const t = useTranslator();
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const values = draft.modelOptions?.yue2 ?? {};
  const update = (patch: Record<string, string | number>) => change({ modelOptions: { ...draft.modelOptions, yue2: { ...values, ...patch } } });
  const refresh = useCallback(() => call<Adapter[]>('adapter.list').then(setAdapters).catch(e => setError(formatCallError(t, e))), [t]);
  useEffect(() => { void refresh(); }, [refresh]);
  const act = (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    void action().then(refresh).catch(e => setError(formatCallError(t, e))).finally(() => setBusy(false));
  };
  const importAdapter = () => act(() => call<Adapter | null>('adapter.import'));
  const options = [{ value: '', label: t('@yovoice.lora.none') }, ...adapters.map(item => ({ value: item.id, label: item.name }))];
  return <VStack gap={3} className="yue-adapters">
    <h3>LoRA</h3>
    {parts.map(part => {
      const id = String(values[`${part.key}_lora`] ?? '');
      const missing = id !== '' && !adapters.some(item => item.id === id);
      return <VStack key={part.key} gap={2}>
        <Selector label={t(part.label)} value={missing ? '' : id} options={options} isDisabled={disabled || busy} onChange={value => update({ [`${part.key}_lora`]: value })} />
        {missing ? <small className="helper">{t('@yovoice.error.adapterMissing')}</small> : null}
        {id && !missing ? <label className="number-field">{t('@yovoice.lora.scale')}<input type="number" min={-10} max={10} step={0.1} value={Number(values[`${part.key}_lora_scale`] ?? 1)} onChange={event => { if (event.target.value !== '') update({ [`${part.key}_lora_scale`]: Number(event.target.value) }); }} /></label> : null}
      </VStack>;
    })}
    <HStack gap={2}>
      <Button size="sm" variant="secondary" label={t('@yovoice.lora.import')} icon={<FolderOpen size={16} />} isDisabled={disabled || busy} onClick={importAdapter} />
    </HStack>
    {error ? <small className="helper" role="alert">{error}</small> : null}
  </VStack>;
}
