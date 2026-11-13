import { Theme } from '@astryxdesign/core/theme';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { SelectableCard } from '@astryxdesign/core/SelectableCard';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import { call } from '../../shared/lib/client';
import { withViewTransition } from '../../shared/lib/view-transition';
import { appThemes, type AppTheme, type State } from '../../shared/workbench';
import { setThemeChoice, themeEntries, type ThemeChoice } from '../../shared/theme/themes';
import { SettingsGroup } from '../../shared/ui/settings-group';

// 卡片里的缩略界面：套上对应主题，用它自己的令牌画侧栏、内容卡片、主按钮和点缀色，所见即切换后的样子。
function ThemePreview({ theme }: { theme: AppTheme }) {
  const entry = themeEntries[theme];
  return <Theme theme={entry.theme} mode={entry.dark ? 'dark' : 'light'}>
    <HStack className="settings-theme-preview" gap={1} aria-hidden>
      <VStack className="settings-theme-preview-nav" gap={1}>
        <StackItem as="span" className="settings-theme-preview-action" />
        <StackItem as="span" className="settings-theme-preview-line" />
        <StackItem as="span" className="settings-theme-preview-line" />
      </VStack>
      <VStack className="settings-theme-preview-sheet" gap={1}>
        <StackItem as="span" className="settings-theme-preview-title" />
        <StackItem as="span" className="settings-theme-preview-line" />
        <HStack className="settings-theme-preview-footer" gap={1} vAlign="center">
          <StackItem as="span" className="settings-theme-preview-action" />
          <StackItem as="span" className="settings-theme-preview-dot" />
        </HStack>
      </VStack>
    </HStack>
  </Theme>;
}

// 设置 › 常规 › 外观：卡片单选主题，点一下立即换色（视图过渡淡入），同时保存到偏好；保存失败时退回原来的主题。
export function AppearanceSettings({ state, run }: { state: State; run: (task: () => Promise<unknown>) => void }) {
  const t = useTranslator();
  const preferences = state.preferences;
  const current: ThemeChoice = preferences.theme ?? 'system';
  const choose = (choice: ThemeChoice) => {
    if (choice === current) return;
    const theme = choice === 'system' ? undefined : choice;
    withViewTransition(() => setThemeChoice(theme), 'theme');
    run(async () => {
      try { await call('preferences.save', { ...preferences, theme }); }
      catch (error) { setThemeChoice(preferences.theme); throw error; }
    });
  };
  const options: ThemeChoice[] = ['system', ...appThemes];
  return <SettingsGroup title={t('@yovoice.settings.appearance')}>
    <VStack className="settings-row settings-theme" gap={3}>
      <VStack className="settings-row-label" gap={1}>
        <p className="settings-row-title">{t('@yovoice.settings.theme')}</p>
        <small>{t('@yovoice.settings.themeHint')}</small>
      </VStack>
      <Grid columns={{ minWidth: 168 }} gap={3} data-testid="theme-options">
        {options.map(option => {
          const name = t(option === 'system' ? '@yovoice.settings.themeSystem' : `@yovoice.settings.theme.${option}`);
          const hint = option === 'system' ? t('@yovoice.settings.themeSystemHint') : t(themeEntries[option].dark ? '@yovoice.settings.themeDark' : '@yovoice.settings.themeLight');
          return <SelectableCard key={option} label={name} isSelected={option === current} onChange={() => choose(option)} padding={2}>
            <VStack gap={2}>
              {option === 'system'
                ? <HStack className="settings-theme-split" gap={0}><ThemePreview theme="paper" /><ThemePreview theme="ink" /></HStack>
                : <ThemePreview theme={option} />}
              <VStack gap={0}>
                <Text weight="semibold">{name}</Text>
                <Text type="supporting">{hint}</Text>
              </VStack>
            </VStack>
          </SelectableCard>;
        })}
      </Grid>
    </VStack>
  </SettingsGroup>;
}
