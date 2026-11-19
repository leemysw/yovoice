import catalog from '@internal/catalog/ming_voices.json';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import type { Draft } from '../../shared/workbench';

/**
 * Ming 3.0 TTS 的控制方式（上游的结构化模板）与副语言标签。
 * 控制方式存在 modelOptions.ming3_tts.template_name，取值和后端一致；各方式互斥，只在非克隆时生效。
 * 内置音色存在 speaker，写的是上游调用名称：带情感的音色为“音色_情感”，如“灵风信_高兴”。
 * 音色和标签取自 internal/catalog/ming_voices.json，与后端校验同源。
 */

type MingVoice = { id: string; language: string; gender: string; emotions?: string[] };
const voices = catalog.voices as MingVoice[];
export const mingTags = catalog.tags;

// 控制方式用到的选项：在高级设置的通用参数里不再重复显示。
export const mingControlKeys = ['template_name', 'emotion', 'dialect', 'speed', 'pitch', 'volume'];
const templates = ['voice_design', 'ip', 'emotion', 'dialect', 'basic', 'freeform'] as const;
const choices = {
  emotion: ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'],
  dialect: ['cantonese', 'chuanyu'],
  speed: ['slow', 'medium', 'fast'],
  pitch: ['low', 'medium', 'high'],
  volume: ['low', 'medium', 'high'],
} as const;
const defaults: Record<keyof typeof choices, string> = { emotion: 'happy', dialect: 'cantonese', speed: 'medium', pitch: 'medium', volume: 'medium' };
// 调用名称里的情感后缀与上游一致（生气，而不是情感控制里的愤怒）。
const suffix: Record<string, string> = { neutral: '中性', happy: '高兴', sad: '悲伤', angry: '生气', fearful: '恐惧', disgusted: '厌恶', surprised: '惊讶' };

export const mingVoiceId = (voice: MingVoice, emotion?: string) => voice.emotions ? `${voice.id}_${suffix[emotion && voice.emotions.includes(emotion) ? emotion : voice.emotions[0]]}` : voice.id;

/** 把调用名称拆成音色和情感；不是收录的名称时返回 undefined。 */
export function parseMingVoice(speaker?: string): { voice: MingVoice; emotion?: string } | undefined {
  for (const voice of voices) {
    if (!voice.emotions) { if (voice.id === speaker) return { voice }; continue; }
    const emotion = voice.emotions.find(item => `${voice.id}_${suffix[item]}` === speaker);
    if (emotion) return { voice, emotion };
  }
  return undefined;
}

export const mingTemplate = (draft: Draft) => (draft.modelOptions?.ming3_tts?.template_name as typeof templates[number] | undefined) ?? 'voice_design';

export function MingControls({ draft, change }: { draft: Draft; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  const options = draft.modelOptions?.ming3_tts ?? {};
  const template = mingTemplate(draft);
  const set = (patch: Record<string, string>, extra: Partial<Draft> = {}) => change({ ...extra, modelOptions: { ...draft.modelOptions, ming3_tts: { ...options, ...patch } } });
  const selected = parseMingVoice(draft.speaker);
  const pick = (key: keyof typeof choices, labels: string = key) => <Selector key={key} label={t(`@yovoice.options.${key}`)} value={String(options[key] ?? defaults[key])}
    options={choices[key].map(value => ({ value, label: t(`@yovoice.ming.${labels}.${value}`) }))} onChange={value => set({ [key]: value })} />;
  const gender = (voice: MingVoice) => voice.gender ? t(`@yovoice.reference.${voice.gender}`) : undefined;
  const section = (title: string, items: MingVoice[]) => ({ type: 'section' as const, title, options: items.map(voice => ({ value: voice.id, label: voice.id, description: gender(voice) })) });
  const description = (label: string, help: string, placeholder: string) => <TextArea label={label} description={help} value={draft.voiceDescription ?? ''} onChange={voiceDescription => change({ voiceDescription: voiceDescription.slice(0, 500) })} placeholder={placeholder} rows={3} />;
  return <>
    <Selector label={t('@yovoice.ming.control')} description={t('@yovoice.ming.controlHelp')} value={template}
      options={templates.map(value => ({ value, label: t(`@yovoice.ming.control.${value}`) }))}
      // 切到内置音色时补上一个有效音色，避免沿用别的模型的音色名。
      onChange={value => set({ template_name: value }, value === 'ip' && !selected ? { speaker: mingVoiceId(voices[0]) } : {})} />
    {template === 'voice_design' ? description(t('@yovoice.vox.voiceDescription'), t('@yovoice.reference.voiceDesignHelp'), t('@yovoice.breeze.voiceDescriptionPlaceholder')) : null}
    {template === 'freeform' ? description(t('@yovoice.ming.freeform'), t('@yovoice.ming.freeformHelp'), t('@yovoice.ming.freeformPlaceholder')) : null}
    {template === 'ip' ? <>
      <Selector label={t('@yovoice.reference.speaker')} value={selected?.voice.id ?? ''} options={[
        section(t('@yovoice.language.zh'), voices.filter(voice => voice.language === 'zh' && !voice.emotions)),
        section(t('@yovoice.ming.emotionVoices'), voices.filter(voice => voice.emotions)),
        section(t('@yovoice.language.en'), voices.filter(voice => voice.language === 'en')),
      ]} onChange={id => { const voice = voices.find(item => item.id === id); if (voice) change({ speaker: mingVoiceId(voice, selected?.emotion) }); }} />
      {selected?.voice.emotions ? <Selector label={t('@yovoice.options.emotion')} value={selected.emotion ?? ''} options={selected.voice.emotions.map(value => ({ value, label: t(`@yovoice.ming.emotion.${value}`) }))} onChange={emotion => change({ speaker: mingVoiceId(selected.voice, emotion) })} /> : null}
    </> : null}
    {template === 'emotion' ? pick('emotion') : null}
    {template === 'dialect' ? pick('dialect') : null}
    {template === 'basic' ? <>{pick('speed')}{pick('pitch', 'level')}{pick('volume', 'level')}</> : null}
  </>;
}

/** 副语言标签：选一个加到正文末尾，模型原样读出对应的声音。克隆和各控制方式都能用。 */
export function MingTags({ draft, change }: { draft: Draft; change: (patch: Partial<Draft>) => void }) {
  const t = useTranslator();
  return <Selector label={t('@yovoice.reference.tags')} description={t('@yovoice.ming.tagsHelp')} value="" options={mingTags.map(value => ({ value, label: `[${value}]` }))} onChange={value => change({ text: `${draft.text}[${value}]` })} />;
}
