import { VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/Selector';
import type { Draft, ModelPackage } from '../../shared/workbench';
import { ModelOptions } from './ModelOptions';

const languages: Record<string, string> = { a: 'en-us', b: 'en-gb', e: 'es', f: 'fr-fr', h: 'hi', i: 'it', j: 'ja', p: 'pt-br', z: 'zh' };

export function KokoroControls({ draft, model, change }: { draft: Draft; model: ModelPackage; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  const voices = model.voices ?? [];
  const speaker = voices.includes(draft.speaker ?? '') ? draft.speaker! : voices.find(voice => voice.startsWith('zf_')) ?? voices[0] ?? '';
  const language = languages[speaker[0]];
  const selectVoice = (speaker: string) => change({ speaker, synthesisLanguage: 'auto' });
  return <VStack gap={4}>
    <Selector label={t('@yovoice.create.language')} placement="below" value={language}
      options={[...new Set(voices.map(voice => languages[voice[0]]))].map(value => ({ value, label: t(`@yovoice.language.${value}`) }))}
      onChange={value => selectVoice(voices.find(voice => languages[voice[0]] === value)!)} />
    <Selector label={t('@yovoice.reference.speaker')} placement="below" value={speaker}
      options={voices.filter(voice => languages[voice[0]] === language).map(value => ({ value, label: value }))} onChange={selectVoice} />
    <p className="muted helper">{t('@yovoice.create.kokoroHelp')}</p>
    <details className="advanced"><summary>{t('@yovoice.create.advanced')}</summary><VStack gap={4} paddingBlockStart={4}>
      <ModelOptions draft={draft} family="kokoro_tts" change={change} />
      <label className="number-field">{t('@yovoice.create.seed')}<input type="number" min={0} max={2147483647} value={draft.seed ?? ''} placeholder={t('@yovoice.create.seedAuto')} onChange={event => change({ seed: event.target.value ? Number(event.target.value) : null })} /></label>
    </VStack></details>
  </VStack>;
}
