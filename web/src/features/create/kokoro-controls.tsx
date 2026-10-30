import { AdvancedSettings, SeedInput } from './shared-controls';
import { VStack } from '@astryxdesign/core/Layout';
import { Slider } from '@astryxdesign/core/Slider';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import type { Draft, ModelPackage } from '../../shared/workbench';
import { ModelOptions } from './model-options';

const languages: Record<string, string> = { a: 'en-us', b: 'en-gb', e: 'es', f: 'fr-fr', h: 'hi', i: 'it', j: 'ja', p: 'pt-br', z: 'zh' };

function parseBlend(value: string, voices: string[]) {
  const match = /^([^()]+)\(([^()]+)\)\+([^()]+)\(([^()]+)\)$/.exec(value);
  if (!match) return undefined;
  const firstWeight = Number(match[2]), secondWeight = Number(match[4]);
  if (!Number.isFinite(firstWeight) || !Number.isFinite(secondWeight) || firstWeight <= 0 || secondWeight <= 0) return undefined;
  if (!voices.includes(match[1]) || !voices.includes(match[3]) || languages[match[1][0]] !== languages[match[3][0]]) return undefined;
  return { first: match[1], second: match[3], ratio: Math.round(secondWeight / (firstWeight + secondWeight) * 100) };
}

const serializeBlend = (first: string, second: string, ratio: number) => `${first}(${(100 - ratio) / 100})+${second}(${ratio / 100})`;

export function KokoroControls({ draft, model, change, advanced, setAdvanced }: { advanced: boolean; setAdvanced: (open: boolean) => void; draft: Draft; model: ModelPackage; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  const voices = model.voices ?? [];
  const blend = parseBlend(draft.speaker ?? '', voices);
  const speaker = blend?.first ?? (voices.includes(draft.speaker ?? '') ? draft.speaker! : voices.find(voice => voice.startsWith('zf_')) ?? voices[0] ?? '');
  const language = languages[speaker[0]];
  const second = voices.find(voice => voice === blend?.second && voice !== speaker) ?? voices.find(voice => languages[voice[0]] === language && voice !== speaker) ?? '';
  const ratio = blend?.ratio ?? 50;
  const selectVoice = (next: string) => {
    const nextSecond = voices.find(voice => voice === second && voice !== next && languages[voice[0]] === languages[next[0]])
      ?? voices.find(voice => languages[voice[0]] === languages[next[0]] && voice !== next);
    change({ speaker: blend && nextSecond ? serializeBlend(next, nextSecond, ratio) : next, synthesisLanguage: 'auto' });
  };
  return <VStack gap={4}>
    <Selector label={t('@yovoice.create.language')} value={language}
      options={[...new Set(voices.map(voice => languages[voice[0]]))].map(value => ({ value, label: t(`@yovoice.language.${value}`) }))}
      onChange={value => { const next = voices.find(voice => languages[voice[0]] === value); if (next) selectVoice(next); }} />
    <Selector label={t('@yovoice.reference.speaker')} value={speaker}
      options={voices.filter(voice => languages[voice[0]] === language).map(value => ({ value, label: value }))} onChange={selectVoice} />
    <Switch label={t('@yovoice.create.blendVoices')} size="sm" value={!!blend} isDisabled={!second} labelPosition="start" labelSpacing="spread"
      onChange={enabled => change({ speaker: enabled && second ? serializeBlend(speaker, second, 50) : speaker, synthesisLanguage: 'auto' })} />
    {blend ? <>
      <Selector label={t('@yovoice.create.secondVoice')} value={second}
        options={voices.filter(voice => languages[voice[0]] === language && voice !== speaker).map(value => ({ value, label: value }))}
        onChange={next => change({ speaker: serializeBlend(speaker, next, ratio), synthesisLanguage: 'auto' })} />
      <Slider label={t('@yovoice.create.secondVoiceWeight')} value={ratio} min={1} max={99} step={1} valueDisplay="text" formatValue={value => `${value}%`}
        onChange={(value: number) => change({ speaker: serializeBlend(speaker, second, value), synthesisLanguage: 'auto' })} />
    </> : null}
    <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
      <ModelOptions draft={draft} family="kokoro_tts" change={change} />
      <SeedInput value={draft.seed} change={change} />
    </AdvancedSettings>
  </VStack>;
}
