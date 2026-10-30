import { useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Check, ChevronRight, ChevronUp, LoaderCircle } from 'lucide-react';
import { Selector } from '../../shared/selector';
import definitions from '@internal/catalog/generation_options.json';
import { formatActivity } from '../../shared/i18n/format';
import { formatTime, isMusicModel, isStableAudio, isYuE, modelEngineReady, type Draft, type ModelPackage, type State } from '../../shared/workbench';
import { AdvancedSettings, SeedInput } from '../create/shared-controls';
import { ModelSelector } from '../create/model-selector';
import { ModelOptions } from '../create/model-options';
import { applyPresetTags, durationPresets, isPresetActive, musicLanguages, splitTags, stylePresets, styleTags, tagHintKey } from './music-draft';
import { useElapsed } from '../../shared/lib/use-elapsed';
import { StableAudioControls, stableAudioOptions, stableAudioReady } from './stable-audio-controls';
import { sfxDurationPresets } from '../sfx/sfx-draft';

const optionValues = (key: string) => definitions.ace_step.find(spec => spec.key === key)?.values ?? [];

// 音乐检查器：常用的时长、演唱语言与风格预设放在右侧面板中，参照情绪预设的层级结构。
export function MusicInspector({ draft, state, catalog, change, generate, cancel, settings, upgradeEngine, advanced, setAdvanced, header, soundEffects = false }: {
  draft: Draft; state: State; catalog: ModelPackage[]; change: (patch: Partial<Draft>) => void; header?: ReactNode;
  generate: () => void; cancel: () => void; settings: () => void; upgradeEngine: () => void; close?: () => void; advanced: boolean; setAdvanced: (value: boolean) => void; soundEffects?: boolean;
}) {
  const t = useTranslator();
  const busy = state.activity?.status === 'running';
  const generating = busy && state.activity?.kind === 'generate' && state.activity.projectId === draft.id;
  const elapsed = useElapsed(generating, state.activity?.startedAt);
  const [moreStyles, setMoreStyles] = useState(false);
  const [tuneStyles, setTuneStyles] = useState(false);
  const options = draft.modelOptions?.ace_step ?? {};
  const option = (key: string, fallback: string | number) => options[key] ?? fallback;
  const update = (key: string, value: string | number) => change({ modelOptions: { ...draft.modelOptions, ace_step: { ...options, [key]: value } } });
  const duration = Number(option('duration_seconds', 0));
  const yueOptions = draft.modelOptions?.yue2 ?? {};
  const yueMode = String(yueOptions.cot ?? 'auto');
  const updateYue = (key: string, value: string | number) => change({ modelOptions: { ...draft.modelOptions, yue2: { ...yueOptions, [key]: value } } });
  const models = catalog.filter(model => soundEffects
    ? model.family === 'stable_audio' && (model.variant === 'sfx' || model.variant === 'medium')
    : isMusicModel(model.id) && (model.variant !== 'sfx' || model.id === draft.modelId));
  const model = models.find(item => item.id === draft.modelId);
  // 已装内核过旧时提前说明原因，生成按钮仍可点击并跳转到内核设置。
  // YuE2 由歌词决定长度、也不接受 ACE-Step 的规划参数，只保留种子。
  const yue = isYuE(draft.modelId);
  // Stable Audio 只按英文描述生成，没有歌词与演唱语言；音效模型也不套用歌曲风格预设。
  const stable = isStableAudio(draft.modelId);
  const sfx = soundEffects || (stable && model?.variant === 'sfx');
  const engineOutdated = !!state.runtimePath && !modelEngineReady(state, model);
  const tags = splitTags(draft.text);
  const groups = Object.keys(styleTags) as (keyof typeof styleTags)[];
  const toggleTag = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag];
    change({ text: next.join(', ').slice(0, 512) });
  };
  return <VStack as="aside" className="inspector music-inspector" gap={0}>
    <VStack className="generation-action" gap={3}>
      {generating ? <Button label={t('@yovoice.create.cancelGenerate')} onClick={cancel} width="100%" />
        : <Button label={t(stable ? '@yovoice.music.generateAudio' : yue && draft.abc?.trim() ? '@yovoice.music.generateFromMelody' : '@yovoice.music.generate')} variant="primary" width="100%" aria-keyshortcuts="Control+Enter" isDisabled={busy || !draft.text.trim() || (yue && !draft.instrumental && !draft.lyrics?.trim()) || (stable && !stableAudioReady(draft, state.history))} onClick={generate} />}
      {generating ? <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
        <small className="grow" role="status">{state.activity ? formatActivity(t, state.activity) : ''}</small>
        <small className="generation-elapsed" aria-label={t('@yovoice.create.elapsed')}>{formatTime(elapsed)}</small>
      </HStack> : engineOutdated ? <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap"><small className="grow">{t('@yovoice.music.engineRequired', { version: model?.engineMinimum })}</small><Button size="sm" label={t('@yovoice.music.updateEngine')} onClick={upgradeEngine} /></HStack> : null}
    </VStack>
    <VStack className="inspector-scroll" gap={5}>
      {header}
      <VStack className="inspector-actions" gap={3}>
        <h2 className="inspector-section-title">{t('@yovoice.create.model')}</h2>
        <ModelSelector label={t('@yovoice.create.model')} models={models} state={state} value={draft.modelId} isDisabled={generating} manage={settings} onChange={modelId => change(isStableAudio(modelId) ? { modelId, instrumental: true } : { modelId })} />
      </VStack>
      {stable ? <StableAudioControls draft={draft} model={model} history={state.history} change={change} durationPresets={soundEffects ? sfxDurationPresets : undefined} /> : yue ? <>
      {/* 生成方式：按旋律谱（有谱按谱、没谱先写谱）或不经过谱自由发挥；纯音乐必须经过谱。 */}
      {draft.instrumental ? null : <VStack gap={2}>
        <h3>{t('@yovoice.music.mode')}</h3>
        <SegmentedControl label={t('@yovoice.music.mode')} size="sm" layout="fill" value={yueMode === 'off' ? 'off' : 'score'} onChange={value => updateYue('cot', value === 'off' ? 'off' : 'auto')}>
          <SegmentedControlItem value="score" label={t('@yovoice.music.modeScore')} />
          <SegmentedControlItem value="off" label={t('@yovoice.music.modeFree')} />
        </SegmentedControl>
      </VStack>}
      </> : <>
      <VStack gap={3}>
        <h3>{t('@yovoice.music.duration')}</h3>
        <SegmentedControl label={t('@yovoice.music.duration')} size="sm" layout="fill" value={String(durationPresets.includes(duration as typeof durationPresets[number]) ? duration : '')} onChange={value => update('duration_seconds', Number(value))}>
          {durationPresets.map(value => <SegmentedControlItem key={value} value={String(value)} label={value ? formatTime(value) : t('@yovoice.music.auto')} />)}
        </SegmentedControl>
      </VStack>
      <HStack className="language-row" vAlign="center" hAlign="between"><h3 aria-hidden="true">{t('@yovoice.music.language')}</h3>
        <Selector label={t('@yovoice.music.language')} isLabelHidden width="calc(var(--spacing-10) * 3)" value={draft.synthesisLanguage || 'zh'} options={musicLanguages.map(value => ({ value, label: t(`@yovoice.music.languageName.${value}`) }))} onChange={synthesisLanguage => change({ synthesisLanguage })} />
      </HStack>
      </>}
      {/* 风格预设（类似情绪预设 UI，纯文字无 emoji） */}
      {sfx ? null : <>
      <VStack gap={2} className="style-presets">
        <HStack className="style-presets-header" hAlign="between" vAlign="center">
          <h3>{t('@yovoice.music.presets')}</h3>
          <Button
            label={t('@yovoice.action.reset')}
            size="sm"
            variant="secondary"
            isDisabled={tags.length === 0}
            onClick={() => change({ text: '' })}
          />
        </HStack>
        <HStack className="emotion-preset-grid" gap={2} role="group" aria-label={t('@yovoice.music.presets')}>
          {stylePresets.slice(0, 3).map(preset => (
            <Button
              key={preset.id}
              label={t(`@yovoice.music.preset.${preset.id}`)}
              size="sm"
              variant="secondary"
              aria-pressed={isPresetActive(preset, tags)}
              onClick={() => change({ text: applyPresetTags(preset, tags).join(', ').slice(0, 512) })}
            />
          ))}
        </HStack>
        {moreStyles ? (
          <HStack id="more-style-presets" className="emotion-preset-grid" gap={2} role="group" aria-label={t('@yovoice.music.moreStyles')}>
            {stylePresets.slice(3).map(preset => (
              <Button
                key={preset.id}
                label={t(`@yovoice.music.preset.${preset.id}`)}
                size="sm"
                variant="secondary"
                aria-pressed={isPresetActive(preset, tags)}
                onClick={() => change({ text: applyPresetTags(preset, tags).join(', ').slice(0, 512) })}
              />
            ))}
          </HStack>
        ) : null}
        <Button
          className="emotion-disclosure"
          label={moreStyles ? t('@yovoice.music.collapseStyles') : t('@yovoice.music.moreStyles')}
          size="sm"
          variant="ghost"
          icon={moreStyles ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          aria-expanded={moreStyles}
          aria-controls={moreStyles ? 'more-style-presets' : undefined}
          onClick={() => setMoreStyles(!moreStyles)}
        />
      </VStack>
      {/* 微调元素：按流派、情绪、乐器、人声分类折叠展开 */}
      <VStack gap={2}>
        <Button
          className="emotion-disclosure"
          label={tuneStyles ? t('@yovoice.music.collapseElements') : t('@yovoice.music.tuneElements')}
          size="sm"
          variant="ghost"
          icon={tuneStyles ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          aria-expanded={tuneStyles}
          aria-controls={tuneStyles ? 'style-tags-panel' : undefined}
          onClick={() => setTuneStyles(!tuneStyles)}
        />
        {tuneStyles ? (
          <VStack id="style-tags-panel" gap={2} role="group" aria-label={t('@yovoice.music.tags')} className="music-tag-panel">
            {groups.map(group => (
              <VStack key={group} gap={1} className="music-tag-group-col">
                <small className="music-tag-group-title">{t(`@yovoice.music.tagGroup.${group}`)}</small>
                <HStack gap={1} vAlign="center" wrap="wrap">
                  {styleTags[group].map(tag => (
                    <Button
                      key={tag}
                      className="music-tag"
                      size="sm"
                      variant="secondary"
                      icon={tags.includes(tag) ? <Check size={12} /> : undefined}
                      aria-pressed={tags.includes(tag)}
                      label={tag}
                      tooltip={t(tagHintKey(tag))}
                      onClick={() => toggleTag(tag)}
                    />
                  ))}
                </HStack>
              </VStack>
            ))}
          </VStack>
        ) : null}
      </VStack>
      </>}
      <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
        {stable ? <>
        <label className="number-field">{t('@yovoice.music.duration')}<input type="number" min={1} max={model?.maxDuration ?? 120} step={1} value={stableAudioOptions(draft).duration} onChange={event => { if (event.target.value) change({ modelOptions: { ...draft.modelOptions, stable_audio: { ...stableAudioOptions(draft).values, duration_seconds: Number(event.target.value) } } }); }} /></label>
        <ModelOptions draft={draft} family="stable_audio" change={change} omit={['duration_seconds', 'edit', 'init_noise_level', 'inpaint_start', 'inpaint_end']} />
        </> : yue ? <ModelOptions draft={draft} family="yue2" change={change} omit={['cot']} /> : <>
        <label className="number-field">{t('@yovoice.music.duration')}<input type="number" min={0} max={300} step={1} value={duration || ''} placeholder={t('@yovoice.music.auto')} onChange={event => update('duration_seconds', event.target.value ? Number(event.target.value) : 0)} /></label>
        <label className="number-field">{t('@yovoice.music.bpm')}<input type="number" min={30} max={300} step={1} value={Number(option('bpm', 0)) || ''} placeholder={t('@yovoice.music.auto')} onChange={event => update('bpm', event.target.value ? Number(event.target.value) : 0)} /></label>
        <Selector label={t('@yovoice.music.keyscale')} value={String(option('keyscale', 'auto'))} options={optionValues('keyscale').map(value => ({ value, label: value === 'auto' ? t('@yovoice.music.auto') : value }))} onChange={value => update('keyscale', value)} />
        <Selector label={t('@yovoice.music.timesignature')} value={String(option('timesignature', 'auto'))} options={optionValues('timesignature').map(value => ({ value, label: value === 'auto' ? t('@yovoice.music.auto') : `${value}/${value === '6' ? 8 : 4}` }))} onChange={value => update('timesignature', value)} />
        <label className="number-field">{t('@yovoice.music.steps')}<input type="number" min={1} max={20} step={1} value={Number(option('num_inference_steps', 8))} onChange={event => { if (event.target.value) update('num_inference_steps', Number(event.target.value)); }} /></label>
        </>}
        <SeedInput value={draft.seed} change={change} />
      </AdvancedSettings>
    </VStack>
  </VStack>;
}
