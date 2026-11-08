import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import { call } from '../../shared/lib/client';
import { featureHidden, optionalFeatures, type Feature, type State } from '../../shared/workbench';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';

const labels: Record<Feature, [string, string]> = {
  story: ['@yovoice.project.story', '@yovoice.settings.featureStoryHint'],
  music: ['@yovoice.project.music', '@yovoice.settings.featureMusicHint'],
  transcribe: ['@yovoice.nav.transcribe', '@yovoice.settings.featureTranscribeHint'],
  assistant: ['@yovoice.assistant.title', '@yovoice.settings.featureAssistantHint'],
};

// 设置 › 通用 › 功能显示：只隐藏入口，已有作品与已下载的模型保持不变，随时可以重新打开。
export function FeatureSettings({ state, run }: { state: State; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const preferences = state.preferences;
  const toggle = (feature: Feature, visible: boolean) => {
    const hidden = (preferences.hiddenFeatures ?? []).filter(item => item !== feature);
    run(() => call('preferences.save', { ...preferences, hiddenFeatures: visible ? hidden : [...hidden, feature] }));
  };
  return <SettingsGroup title={t('@yovoice.settings.features')} description={t('@yovoice.settings.featuresHint')}>
    {optionalFeatures.map(feature => <SettingsRow key={feature} label={t(labels[feature][0])} hint={t(labels[feature][1])}>
      <Switch label={t(labels[feature][0])} isLabelHidden value={!featureHidden(preferences, feature)} onChange={visible => toggle(feature, visible)} />
    </SettingsRow>)}
  </SettingsGroup>;
}
