import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Slider } from '@astryxdesign/core/Slider';
import { AudioLines, Play, ChevronRight } from 'lucide-react';
import type { Draft, State, Track } from '../../shared/workbench';

export function VoxControls({ draft, state, change, chooseVoice, play, advanced, setAdvanced }: {
  draft: Draft; state: State; change: (patch: Partial<Draft>) => void; chooseVoice: () => void;
  play: (track: Track) => void; advanced: boolean; setAdvanced: (value: boolean) => void;
}) {
  const mode = draft.voxMode || 'design';
  const voice = state.voices.find(item => item.id === draft.voiceId);
  return <>
    <VStack gap={3}>
      <h3>生成方式</h3>
      <SegmentedControl label="生成方式" size="sm" layout="fill" value={mode} onChange={value => change({ voxMode: value as Draft['voxMode'] })}>
        <SegmentedControlItem value="design" label="声音设计" />
        <SegmentedControlItem value="clone" label="音色克隆" />
        <SegmentedControlItem value="continuation" label="精细克隆" />
      </SegmentedControl>
      <p className="muted helper">{mode === 'design' ? '文字设计音色，无需参考音频' : mode === 'clone' ? '复刻参考音色，可调整演绎风格' : '参考音频＋原文，保留演绎细节'}</p>
    </VStack>
    {mode !== 'design' ? <VStack gap={3}>
      <h3>参考音色</h3>
      <HStack className="voice-selected" gap={3} vAlign="center">
        <Button label={voice?.name ?? '添加参考音频'} icon={<AudioLines className="voice-mark" size={20} />} variant="ghost" className="voice-title grow" onClick={chooseVoice} />
        {voice ? <Button label="试听当前音色" isIconOnly icon={<Play size={17} />} variant="ghost" onClick={() => play({ ...voice, kind: 'voices', subtitle: '参考音频' })} /> : null}
      </HStack>
    </VStack> : null}
    {mode === 'continuation' ? <TextArea label="参考音频原文" value={draft.referenceText ?? ''} onChange={value => change({ referenceText: value.slice(0, 2000) })} placeholder="准确填写参考音频中说出的内容，不是待生成的正文。" rows={4} /> :
      <TextArea label={mode === 'design' ? '声音描述' : '风格指导（可选）'} value={draft.voiceDescription ?? ''} onChange={value => change({ voiceDescription: value.slice(0, 500) })} placeholder={mode === 'design' ? '如：温柔女声，舒缓语速；留空自然演绎' : '例如：带着喜悦，语速轻快。'} rows={3} />}
    <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)} className="advanced">
      <summary><ChevronRight size={16} aria-hidden="true" />高级设置</summary>
      <VStack gap={4} paddingBlockStart={4}>
        <Slider label="引导强度" value={draft.guidanceScale || 2} min={0.5} max={5} step={0.1} onChange={(guidanceScale: number) => change({ guidanceScale })} valueDisplay="text" formatValue={value => value.toFixed(1)} />
        <p className="muted helper">默认 2.0；提高数值会增强提示约束，过高可能影响自然度。</p>
        <label className="number-field">推理步数<input type="number" min={1} max={50} value={draft.inferenceSteps || 10} onChange={event => { if (event.target.value) change({ inferenceSteps: Number(event.target.value) }); }} /></label>
        <label className="number-field">随机种子<input type="number" min={0} max={2147483647} value={draft.seed ?? ''} placeholder="自动" onChange={event => change({ seed: event.target.value ? Number(event.target.value) : null })} /></label>
      </VStack>
    </details>
  </>;
}
