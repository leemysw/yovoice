import { Button } from '@astryxdesign/core/Button';
import { useTranslator } from '@astryxdesign/core/i18n';
import { call } from '../../shared/lib/client';
import { Selector } from '../../shared/selector';
import { SettingsGroup, SettingsRow } from '../../shared/ui/settings-group';
import { recognizerFamilies, type ModelKind, type ModelPackage, type State } from '../../shared/workbench';

// 「设置 › 模型 › 默认模型」：一件事有几个已下载的模型可用时，在这里选默认用哪一个。
// 语音识别：转写、识别参考文本和命令行共用；没选或选的已移除时与后端一样按家族顺序取第一个已装的。
// 歌词对齐的人声分离：对齐包自带 BS-RoFormer，另下载了 HTDemucs 6-stem 时可以换成它，快很多但人声没那么干净。
// 某件事还没有可用模型时显示“还没下载”，点“去下载”跳到对应的子页。
export function DefaultModels({ state, catalog, musicHidden, run, open }: {
  state: State; catalog: ModelPackage[]; musicHidden: boolean; run: (task: () => Promise<unknown>) => void; open: (kind: ModelKind) => void;
}) {
  const t = useTranslator();
  const { preferences } = state;
  const installed = (model: ModelPackage) => state.models.some(item => item.id === model.id);
  const recognizers = [...recognizerFamilies].flatMap(family => catalog.filter(model => model.family === family && installed(model)));
  const recognizer = recognizers.find(model => model.id === preferences.recognizeModel) ?? recognizers[0];
  const aligner = catalog.some(model => model.family === 'lyric_align' && installed(model));
  const htdemucs = catalog.some(model => model.family === 'htdemucs_6stems' && installed(model));
  const separator = htdemucs && preferences.alignSeparator === 'htdemucs' ? 'htdemucs' : 'bs_roformer';
  const save = (patch: Partial<State['preferences']>) => run(() => call('preferences.save', { ...preferences, ...patch }));
  const missing = (kind: ModelKind) => <Button size="sm" variant="ghost" label={t('@yovoice.settings.defaultModelGet')} onClick={() => open(kind)} />;
  return <SettingsGroup>
    <SettingsRow label={t('@yovoice.settings.recognizeModel')} hint={recognizers.length ? t('@yovoice.settings.recognizeModelHint') : t('@yovoice.settings.defaultModelMissing')}>
      {recognizer ? <Selector size="sm" label={t('@yovoice.settings.recognizeModel')} isLabelHidden isDisabled={recognizers.length < 2} value={recognizer.id}
        options={recognizers.map(model => ({ value: model.id, label: `${model.name} · ${model.precision}` }))}
        onChange={recognizeModel => save({ recognizeModel })} width="calc(var(--spacing-10) * 6)" /> : missing('asr-models')}
    </SettingsRow>
    {musicHidden ? null : <SettingsRow label={t('@yovoice.settings.alignSeparator')} hint={aligner ? t(htdemucs ? '@yovoice.settings.alignSeparatorHint' : '@yovoice.settings.alignSeparatorMore') : t('@yovoice.settings.defaultModelMissing')}>
      {aligner ? <Selector size="sm" label={t('@yovoice.settings.alignSeparator')} isLabelHidden isDisabled={!htdemucs} value={separator}
        options={[{ value: 'bs_roformer', label: t('@yovoice.settings.alignSeparatorRoformer') }, ...(htdemucs ? [{ value: 'htdemucs', label: t('@yovoice.settings.alignSeparatorHtdemucs') }] : [])]}
        onChange={value => save({ alignSeparator: value === 'htdemucs' ? 'htdemucs' : undefined })} width="calc(var(--spacing-10) * 6)" /> : missing('music-models')}
    </SettingsRow>}
  </SettingsGroup>;
}
