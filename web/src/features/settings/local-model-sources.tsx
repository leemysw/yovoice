import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { FolderOpen, FolderSearch } from 'lucide-react';
import { call, isDesktop } from '../../shared/lib/client';
import { readLocal, writeLocal } from '../../shared/lib/local-store';
import { formatCallError } from '../../shared/i18n/format';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import type { ModelPackage } from '../../shared/workbench';

interface Source { path: string; models: string[]; convert?: boolean; manual?: boolean }
interface Scan { directory: string; sources: Source[]; limited?: boolean }
interface ConversionTools { python: string; converter: string }

export function LocalModelSources({ catalog, busy }: { catalog: ModelPackage[]; busy: boolean }) {
  const t = useTranslator();
  const [scan, setScan] = useState<Scan | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [checkpoint, setCheckpoint] = useState<Source | null>(null);
  const [convertID, setConvertID] = useState('');
  const [python, setPython] = useState(() => readLocal('yovoice.modelConversion.python') ?? '');
  const [converter, setConverter] = useState(() => readLocal('yovoice.modelConversion.converter') ?? '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const label = (id: string) => {
    const model = catalog.find(model => model.id === id);
    return model ? `${model.name} · ${model.precision}` : id;
  };
  const selected = Object.entries(mapping).filter(([, id]) => id).map(([path, id]) => ({ path, id }));
  const conflict = new Set(selected.map(item => item.id)).size !== selected.length;
  async function run(action: () => Promise<void>) {
    setError('');
    setWorking(true);
    try { await action(); }
    catch (error) { setError(formatCallError(t, error)); }
    finally { setWorking(false); }
  }
  function open() {
    void run(async () => {
      const result = await call<Scan | null>('model.scan');
      if (!result) return;
      const tools = await call<ConversionTools>('model.conversionTools');
      if (tools.python) setPython(tools.python);
      if (tools.converter) setConverter(tools.converter);
      setMapping(Object.fromEntries(result.sources.filter(source => !source.convert && !source.manual && source.models.length === 1).map(source => [source.path, source.models[0]])));
      setScan(result);
    });
  }
  function close() { setScan(null); setCheckpoint(null); setError(''); }
  if (!isDesktop) return null;
  return <VStack gap={2}>
    <Button size="sm" icon={<FolderSearch size={16} />} label={t('@yovoice.settings.scanLocalModels')} isLoading={working && !scan} isDisabled={busy || working} onClick={open} />
    {error && !scan ? <small role="alert">{error}</small> : null}
    {scan ? checkpoint ? <AppDialog title={t('@yovoice.settings.convertCheckpoint')} subtitle={checkpoint.path} width={560} busy={working} error={error} onClose={() => { setCheckpoint(null); setError(''); }} actions={<>
      <Button label={t('@yovoice.action.cancel')} isDisabled={working} onClick={() => { setCheckpoint(null); setError(''); }} />
      <Button label={t('@yovoice.settings.convertCheckpoint')} variant="primary" isLoading={working} isDisabled={busy || !python.trim() || !converter.trim()} onClick={() => void run(async () => {
        await call('model.convert', { path: checkpoint.path, id: convertID, python: python.trim(), converter: converter.trim() });
        close();
      })} />
    </>}>
      <p>{t('@yovoice.settings.converterToolsHint')}</p>
      <Selector label={t('@yovoice.settings.localModelChoice')} options={checkpoint.models.map(id => ({ value: id, label: label(id) }))} value={convertID} onChange={setConvertID} />
      {([
        { key: 'python', label: '@yovoice.settings.pythonPath', value: python, set: setPython },
        { key: 'converter', label: '@yovoice.settings.ggufToolPath', value: converter, set: setConverter },
      ] as const).map(tool => {
        const change = (path: string) => {
          tool.set(path);
          writeLocal(`yovoice.modelConversion.${tool.key}`, path);
        };
        return <HStack key={tool.key} gap={2} vAlign="end">
          <TextInput className="grow" label={t(tool.label)} value={tool.value} onChange={change} isDisabled={working} />
          <Button variant="secondary" isIconOnly icon={<FolderOpen />} label={t(tool.label)} isDisabled={working} onClick={() => void run(async () => {
            const path = await call<string | null>('model.conversionTool');
            if (path) change(path);
          })} />
        </HStack>;
      })}
    </AppDialog> : <AppDialog title={t('@yovoice.settings.scanLocalModels')} subtitle={scan.directory} width={680} busy={working} error={error || (conflict ? t('@yovoice.settings.modelMappingConflict') : '')} onClose={close} actions={<>
      <Button label={t('@yovoice.action.cancel')} isDisabled={working} onClick={close} />
      <Button label={t('@yovoice.settings.importSelection')} variant="primary" isLoading={working} isDisabled={busy || !selected.length || conflict} onClick={() => void run(async () => {
        await call('model.importBatch', { models: selected });
        close();
      })} />
    </>}>
      {scan.limited ? <p>{t('@yovoice.settings.modelScanLimited')}</p> : null}
      {scan.sources.length === 0 ? <p>{t('@yovoice.settings.modelScanEmpty')}</p> : null}
      {scan.sources.map(source => <VStack key={source.path} gap={1}>
        <small title={source.path}>{source.path}</small>
        {source.convert ? <HStack gap={2}>
          <Button size="sm" label={t('@yovoice.settings.convertCheckpoint')} isDisabled={busy || working} onClick={() => {
            setConvertID(source.models[0]); setCheckpoint(source); setError('');
          }} />
        </HStack> : <Selector size="sm" label={t('@yovoice.settings.localModelChoice')} value={mapping[source.path] || 'skip'} isDisabled={working}
          options={[{ value: 'skip', label: t('@yovoice.settings.skipModel') }, ...source.models.map(id => ({ value: id, label: label(id) }))]}
          onChange={id => setMapping(previous => ({ ...previous, [source.path]: id === 'skip' ? '' : id }))} />}
      </VStack>)}
    </AppDialog> : null}
  </VStack>;
}
