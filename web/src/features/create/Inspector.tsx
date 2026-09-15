import { useEffect, useState } from 'react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Slider } from '@astryxdesign/core/Slider';
import { Selector, SelectorOption } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { AudioLines, ChevronUp, ChevronRight, Play, LoaderCircle } from 'lucide-react';
import { formatTime, type Draft, type Mode, type State, type ModelPackage } from '../../shared/workbench';
import type { Track } from '../../shared/workbench';
const modes: [Mode, string][] = [['speaker', '跟随音色'], ['reference', '参考演绎'], ['vector', '情绪调节'], ['text', '文字指导']];
const emotions = ['高兴', '愤怒', '悲伤', '恐惧', '厌恶', '低落', '惊讶', '平静'];
// 预设是可继续微调的情绪组合，不代表模型保证的演绎效果。
const emotionPresets = [
  { label: '平静', description: '平稳叙述，适合说明与旁白', values: [0, 0, 0, 0, 0, 0, 0, 0.6] },
  { label: '愉快', description: '轻快表达，适合问候与分享', values: [0.6, 0, 0, 0, 0, 0, 0.1, 0] },
  { label: '温柔', description: '平静中带少量愉悦，适合关怀语句', values: [0.15, 0, 0, 0, 0, 0, 0, 0.5] },
  { label: '惊喜', description: '高兴与惊讶混合，适合好消息', values: [0.4, 0, 0, 0, 0, 0, 0.35, 0] },
  { label: '伤感', description: '悲伤与低落混合，适合回忆与告别', values: [0, 0, 0.35, 0, 0, 0.2, 0, 0.15] },
  { label: '紧张', description: '恐惧与惊讶混合，适合悬念对白', values: [0, 0, 0, 0.35, 0, 0, 0.2, 0] },
  { label: '愤怒', description: '突出愤怒，适合冲突对白', values: [0, 0.5, 0, 0, 0, 0, 0, 0] },
  { label: '悲伤', description: '突出悲伤，适合失落与告别', values: [0, 0, 0.5, 0, 0, 0, 0, 0] },
  { label: '恐惧', description: '突出害怕，适合危险情境', values: [0, 0, 0, 0.45, 0, 0, 0, 0] },
  { label: '厌恶', description: '突出反感，适合拒绝与排斥', values: [0, 0, 0, 0, 0.45, 0, 0, 0] },
  { label: '低落', description: '突出低落，适合失望与独白', values: [0, 0, 0, 0, 0, 0.5, 0, 0] },
  { label: '惊讶', description: '突出意外，适合疑问与发现', values: [0, 0, 0, 0, 0, 0, 0.5, 0] },
];
export function Inspector({ draft, state, catalog, change, chooseVoice, chooseEmotion, play, generate, cancel, settings, advanced, setAdvanced, close }: {
  draft: Draft; state: State; catalog: ModelPackage[]; change: (patch: Partial<Draft>) => void; chooseVoice: () => void; chooseEmotion: () => void;
  play: (track: Track) => void; generate: () => void; cancel: () => void; settings: () => void; close: () => void; advanced: boolean; setAdvanced: (v: boolean) => void;
}) {
  const voice = state.voices.find(v => v.id === draft.voiceId); const emotion = state.voices.find(v => v.id === draft.emotionVoiceId);
  const selectedPreset = emotionPresets.find(preset => preset.values.every((value, i) => Math.abs(value - draft.emotions[i]) < 0.001));
  const busy = state.activity?.status === 'running';
  const generating = busy && state.activity?.kind === 'generate';
  const [tuneEmotions, setTuneEmotions] = useState(false);
  const [moreEmotions, setMoreEmotions] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!generating) { setElapsed(0); return; }
    const started = state.activity?.startedAt ? Date.parse(state.activity.startedAt) : Date.now();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [generating, state.activity?.startedAt]);
  return <VStack as="aside" className="inspector" gap={0}>
    <VStack className="generation-action" gap={3}>
      {busy && state.activity?.kind === 'generate' ? <Button label="取消生成" onClick={cancel} width="100%" /> : <Button label="生成语音" variant="primary" width="100%" size="lg" aria-keyshortcuts="Control+Enter" isDisabled={busy || !draft.text.trim()} onClick={generate} />}
      {generating ? <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
        <small className="grow" role="status">{state.activity?.label}</small>
        <small className="generation-elapsed" aria-label="已用时间">{formatTime(elapsed)}</small>
      </HStack> : null}
    </VStack>
    <VStack className="inspector-scroll" gap={5}>
    <VStack className="inspector-actions" gap={3}>
      <h2 className="inspector-section-title">模型</h2>
      <Selector label="模型" isLabelHidden placement="below" renderOption={option => <SelectorOption label={option.label} description={option.description} layout="inline" />} renderValue={option => option.label} className="model-selector" width="100%" value={draft.modelId} isDisabled={busy}
        options={[...catalog.map(model => ({ value: model.id, label: `${model.name} · ${model.precision}`, description: state.models.some(installed => installed.id === model.id) ? '已安装' : '未下载' })), { value: 'manage', label: '管理模型…' }]}
        onChange={modelId => { if (modelId === 'manage') { settings(); return; } change({ modelId, language: modelId.startsWith('index-2.5') || ['zh', 'en'].includes(draft.language) ? draft.language : 'zh' }); }} />

    </VStack>
    <HStack className="inspector-heading" hAlign="between" vAlign="center"><h2 className="inspector-section-title">声音设置</h2><Button label="返回正文" className="inspector-toggle" variant="ghost" onClick={close} /></HStack>
      <VStack gap={3}>
        <h3>参考音色</h3>
        <HStack className="voice-selected" gap={3} vAlign="center">
          <Button label={voice?.name ?? '添加参考音频'} icon={<AudioLines className="voice-mark" size={20} />} variant="ghost" className="voice-title grow" onClick={chooseVoice} />
          {voice ? <Button label="试听当前音色" isIconOnly icon={<Play size={17} />} variant="ghost" onClick={() => play({ ...voice, kind: 'voices', subtitle: '参考音频' })} /> : null}
        </HStack>
      </VStack>
      <VStack gap={3}>
        <h3>表达方式</h3>
        <SegmentedControl size="sm" label="表达方式" value={draft.mode} onChange={mode => change({ mode: mode as Mode })} layout="fill">{modes.map(([id, label]) => <SegmentedControlItem key={id} value={id} label={label} />)}</SegmentedControl>
        {draft.mode === 'speaker' ? <p className="muted helper">沿用参考音色中的自然表达。</p> : null}
        {draft.mode === 'reference' ? <VStack gap={3}><Button label={emotion?.name ?? '添加演绎参考'} icon={<AudioLines size={17} />} onClick={chooseEmotion} width="100%" /><p className="muted helper">从另一段音频参考情绪，保留当前音色。</p></VStack> : null}
        {draft.mode === 'text' ? <VStack gap={3}>
          <TextArea label="情绪描述" isLabelHidden value={draft.emotionText} onChange={value => change({ emotionText: value.slice(0, 500) })} placeholder="描述你希望听到的情绪…" rows={3} isDisabled={draft.inferEmotion} />
          <Switch label="根据正文识别情绪" size="sm" value={draft.inferEmotion} onChange={value => change({ inferEmotion: value })} labelPosition="start" labelSpacing="spread" />
        </VStack> : null}
        {draft.mode === 'vector' ? <VStack gap={0}>
          <VStack gap={2} className="emotion-presets">
            <HStack hAlign="between" vAlign="center"><h3>情绪预设</h3><Button label="重置" size="sm" variant="ghost" onClick={() => change({ emotions: Array(8).fill(0) })} /></HStack>
            <HStack className="emotion-preset-grid" gap={2} role="group" aria-label="情绪预设">{emotionPresets.slice(0, 3).map(preset => <Button key={preset.label} label={preset.label} size="sm" variant="ghost" aria-pressed={selectedPreset === preset} onClick={() => change({ emotions: [...preset.values] })} />)}</HStack>
            {moreEmotions ? <HStack id="more-emotion-presets" className="emotion-preset-grid" gap={2} role="group" aria-label="更多情绪预设">{emotionPresets.slice(3).map(preset => <Button key={preset.label} label={preset.label} size="sm" variant="ghost" aria-pressed={selectedPreset === preset} onClick={() => change({ emotions: [...preset.values] })} />)}</HStack> : null}
            <Button className="emotion-disclosure" label={moreEmotions ? '收起情绪' : '更多情绪'} size="sm" variant="ghost" icon={moreEmotions ? <ChevronUp aria-hidden="true" /> : <ChevronRight aria-hidden="true" />} aria-expanded={moreEmotions} aria-controls={moreEmotions ? 'more-emotion-presets' : undefined} onClick={() => setMoreEmotions(!moreEmotions)} />
          </VStack>
          <VStack gap={2}>
            <Button className="emotion-disclosure" label="微调情绪" size="sm" variant="ghost" icon={tuneEmotions ? <ChevronUp aria-hidden="true" /> : <ChevronRight aria-hidden="true" />} aria-expanded={tuneEmotions} aria-controls={tuneEmotions ? 'emotion-sliders' : undefined} onClick={() => setTuneEmotions(!tuneEmotions)} />
            {tuneEmotions ? <VStack id="emotion-sliders" gap={3}>{emotions.map((name, i) => <Slider key={name} label={name} min={0} max={1} step={0.05} value={draft.emotions[i]} onChange={(value: number) => change({ emotions: draft.emotions.map((v, n) => n === i ? value : v) })} valueDisplay="text" formatValue={v => `${Math.round(v * 100)}%`} />)}</VStack> : null}
          </VStack>
        </VStack> : null}
        {draft.mode !== 'speaker' ? <Slider label="情绪强度" value={draft.emotionStrength} min={0} max={1} step={0.05} onChange={(value: number) => change({ emotionStrength: value })} valueDisplay="text" formatValue={v => `${Math.round(v * 100)}%`} /> : null}
      </VStack>
      <VStack gap={4}>
        <HStack className="language-row" vAlign="center" hAlign="between"><h3 aria-hidden="true">语言</h3><Selector placement="below" label="语言" isLabelHidden width="calc(var(--spacing-10) * 3)" value={draft.language} options={(draft.modelId.startsWith('index-2.5') ? [['zh', '中文'], ['en', '英语'], ['ja', '日语'], ['es', '西班牙语'], ['ar', '阿拉伯语']] : [['zh', '中文'], ['en', '英语']]).map(([value, label]) => ({ value, label }))} onChange={language => change({ language })} /></HStack>
        <Slider label="语速" value={draft.speed} min={0.5} max={2} step={0.05} onChange={(speed: number) => change({ speed })} valueDisplay="text" formatValue={v => `${v.toFixed(2)}×`} />
      </VStack>
      <details open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)} className="advanced"><summary><ChevronRight size={16} aria-hidden="true" />高级设置</summary><VStack gap={4} paddingBlockStart={4}>
        {['text', 'vector'].includes(draft.mode) ? <Switch label="情绪随机变化" size="sm" value={draft.randomEmotion} onChange={randomEmotion => change({ randomEmotion })} /> : null}
        <Switch label="随机采样" size="sm" value={draft.doSample} onChange={v => change({ doSample: v })} />
        {([
          ['temperature', '温度', 0.05, 2, 0.05], ['topP', 'Top P', 0.01, 1, 0.01], ['topK', 'Top K', 1, 200, 1],
          ['repetitionPenalty', '重复惩罚', 0.1, 20, 0.1], ['maxTokens', '最大生成长度', 50, 4000, 50],
          ['intervalSilenceMs', '段间停顿（毫秒）', 0, 2000, 50], ['numBeams', '束搜索数量', 1, 10, 1], ['lengthPenalty', '长度惩罚', -2, 2, 0.1],
        ] as const).map(([key, label, min, max, step]) => <label key={key} className="number-field">{label}<input type="number" min={min} max={max} step={step} value={draft[key]} onChange={e => { if (e.target.value !== '') change({ [key]: Number(e.target.value) }); }} /></label>)}
        <label className="number-field">随机种子<input type="number" min={0} max={2147483647} value={draft.seed ?? ''} placeholder="自动" onChange={e => change({ seed: e.target.value ? Number(e.target.value) : null })} /></label>
      </VStack></details>
    </VStack>

  </VStack>;
}
