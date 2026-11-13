import { liveAudioPlayer, prepareLivePlayback } from '../features/media/live-audio-player';
import { call } from '../shared/lib/client';
import { useHotkey } from '../shared/hotkeys/hotkeys';
import { modelEngineReady, projectKind, requiresVoice, runtimeStatus, runtimeUsable, type Draft, type EngineInfo, type ModelPackage, type State } from '../shared/workbench';
import type { DraftSession } from './use-draft-session';
import type { VoicePickerMode } from './workbench-overlays';
import { kindHidden } from './use-workbench-navigation';

/** 作品类型对应的生成命令：快捷键与按钮提示共用。 */
export function generateCommand(draft: Draft): string {
  const kind = projectKind(draft);
  return kind === 'story' ? 'story.generate' : kind === 'music' ? 'music.generate' : kind === 'score' ? 'score.render' : kind === 'sfx' ? 'sfx.generate' : 'create.generate';
}

// 生成前的校验与启动：缺参考音频、模型或推理引擎时先引导到对应位置；生成快捷键只在编辑页生效。
export function useGenerate({ state, engine, catalog, draft, page, openSettings, run, persistDraft, setVoicePicker }: Pick<DraftSession, 'draft' | 'persistDraft'> & {
  state: State; engine: EngineInfo; catalog: ModelPackage[]; page: string; openSettings: (modelId?: string, requested?: string) => void; run: (action: () => Promise<unknown>) => void; setVoicePicker: (picker: VoicePickerMode) => void;
}) {
  const generate = () => {
    if (state.activity?.status === 'running') return;
    const start = () => {
      const streaming = draft.runtime?.streaming || draft.subtitles?.speakers.some(speaker => speaker.settings?.runtime?.streaming) || draft.subtitles?.cues.some(cue => cue.performance?.settings.runtime?.streaming);
      if (streaming) prepareLivePlayback(draft.id);
      run(async () => {
        try { await persistDraft(draft); await call('generation.start', draft); }
        catch (error) { if (streaming) liveAudioPlayer.stop(); throw error; }
      });
    };
    // 还没准备好时：缺参考音频直接打开声音选择，缺模型或推理引擎跳到设置里对应的页面。
    if (draft.subtitles) {
      const missing = draft.subtitles.speakers.map(s => ({ ...draft, ...s.settings })).find(d => !state.models.some(m => m.id === d.modelId));
      if (missing || !runtimeUsable(runtimeStatus(state, engine))) { openSettings(missing?.modelId ?? draft.modelId, missing ? 'models' : 'engine'); return; }
      start(); return;
    }
    // 编曲只需要音色库，不经过推理引擎。
    if (projectKind(draft) === 'score') {
      if (!state.models.some(m => m.id === draft.modelId)) { openSettings(draft.modelId, 'models'); return; }
      start(); return;
    }
    if (requiresVoice(draft) &&!state.voices.some(voice => voice.id === draft.voiceId)) { setVoicePicker('voice'); return; }
    if (!runtimeUsable(runtimeStatus(state, engine)) || !state.models.some(m => m.id === draft.modelId) || !modelEngineReady(state, catalog.find(m => m.id === draft.modelId))) {
      openSettings(draft.modelId, !state.models.some(m => m.id === draft.modelId) ? 'models' : 'engine'); return;
    }
    start();
  };
  // 生成快捷键（默认 ⌘↵ / Ctrl+Enter）按作品类型对应不同的命令，只在编辑页生效；对话框或角色编辑器打开时不响应。
  // 作品所属的功能（故事配音、音乐生成）在设置里隐藏后，仍停留在它的编辑页也不响应。
  const command = generateCommand(draft);
  const editing = page === 'create' && !kindHidden(state.preferences, projectKind(draft));
  const shortcut = () => { if (!Array.from(document.querySelectorAll('[data-character-active=true]')).some(e => e.getClientRects().length > 0)) generate(); };
  useHotkey('create.generate', shortcut, { enabled: editing && command === 'create.generate' });
  useHotkey('story.generate', shortcut, { enabled: editing && command === 'story.generate' });
  useHotkey('music.generate', shortcut, { enabled: editing && command === 'music.generate' });
  useHotkey('score.render', shortcut, { enabled: editing && command === 'score.render' });
  useHotkey('sfx.generate', shortcut, { enabled: editing && command === 'sfx.generate' });
  return generate;
}
