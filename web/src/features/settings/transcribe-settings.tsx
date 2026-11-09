import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { call } from '../../shared/lib/client';
import { transcribeDefaults, transcribeRanges, transcribeSettings, type State, type TranscribeSettings as Settings } from '../../shared/workbench';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';

// 每一项的文案与步长；提示可选。
const fields: { key: keyof Settings; label: string; hint?: string; step: number }[] = [
  { key: 'maxFileMB', label: '@yovoice.settings.transcribeMaxFile', step: 1 },
  { key: 'maxMinutes', label: '@yovoice.settings.transcribeMaxMinutes', hint: '@yovoice.settings.transcribeMaxMinutesHint', step: 1 },
  { key: 'lineChars', label: '@yovoice.settings.transcribeLineChars', hint: '@yovoice.settings.transcribeLineCharsHint', step: 1 },
  { key: 'lineSeconds', label: '@yovoice.settings.transcribeLineSeconds', step: .5 },
  { key: 'linePause', label: '@yovoice.settings.transcribeLinePause', hint: '@yovoice.settings.transcribeLinePauseHint', step: .1 },
];

// 设置 › 常规 › 语音转写：文件与时长上限在服务端生效，断句参数用于新的转写和还没编辑过的转写。
// 与默认值相同的项不保存，全部为默认时整组清空。
export function TranscribeSettings({ state, run }: { state: State; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const preferences = state.preferences;
  const current = transcribeSettings(preferences);
  const save = (key: keyof Settings, value: number) => {
    const next: Settings = { ...preferences.transcribe };
    if (value === transcribeDefaults[key]) delete next[key]; else next[key] = value;
    run(() => call('preferences.save', { ...preferences, transcribe: Object.keys(next).length ? next : undefined }));
  };
  return <SettingsGroup title={t('@yovoice.settings.transcribe')} description={t('@yovoice.settings.transcribeHint')}
    actions={<Button size="sm" variant="secondary" label={t('@yovoice.settings.transcribeReset')} isDisabled={!preferences.transcribe} onClick={() => run(() => call('preferences.save', { ...preferences, transcribe: undefined }))} />}>
    {fields.map(field => <SettingsRow key={field.key} label={t(field.label)} hint={field.hint ? t(field.hint) : undefined}>
      <NumberInput size="sm" label={t(field.label)} isLabelHidden isIntegerOnly={field.step === 1} min={transcribeRanges[field.key][0]} max={transcribeRanges[field.key][1]} step={field.step}
        value={current[field.key]} onChange={value => save(field.key, value)} width="calc(var(--spacing-10) * 3)" />
    </SettingsRow>)}
  </SettingsGroup>;
}
