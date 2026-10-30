import { useEffect, useEffectEvent } from 'react';
import { call } from '../shared/lib/client';
import { modelEngineReady, projectKind, requiresVoice, runtimeStatus, runtimeUsable, type EngineInfo, type ModelPackage, type State } from '../shared/workbench';
import type { DraftSession } from './use-draft-session';
import type { VoicePickerMode } from './workbench-overlays';

// 生成前的校验与启动：缺参考音频、模型或推理引擎时先引导到对应位置；Ctrl/⌘+Enter 快捷键只在创作页生效。
export function useGenerate({ state, engine, catalog, draft, page, openSettings, run, persistDraft, setVoicePicker }: Pick<DraftSession, 'draft' | 'persistDraft'> & {
  state: State; engine: EngineInfo; catalog: ModelPackage[]; page: string; openSettings: (modelId?: string, requested?: string) => void; run: (action: () => Promise<unknown>) => void; setVoicePicker: (picker: VoicePickerMode) => void;
}) {
  const generate = () => {
    if (state.activity?.status === 'running') return;
    // 还没准备好时：缺参考音频直接打开声音选择，缺模型或推理引擎跳到设置里对应的页面。
    if (draft.subtitles) {
      const missing = draft.subtitles.speakers.map(s => ({ ...draft, ...s.settings })).find(d => !state.models.some(m => m.id === d.modelId));
      if (missing || !runtimeUsable(runtimeStatus(state, engine))) { openSettings(missing?.modelId ?? draft.modelId, missing ? 'models' : 'engine'); return; }
      run(async () => { await persistDraft(draft); await call('generation.start', draft); }); return;
    }
    // 编曲只需要音色库，不经过推理引擎。
    if (projectKind(draft) === 'score') {
      if (!state.models.some(m => m.id === draft.modelId)) { openSettings(draft.modelId, 'models'); return; }
      run(async () => { await persistDraft(draft); await call('generation.start', draft); }); return;
    }
    if (requiresVoice(draft) &&!state.voices.some(voice => voice.id === draft.voiceId)) { setVoicePicker('voice'); return; }
    if (!runtimeUsable(runtimeStatus(state, engine)) || !state.models.some(m => m.id === draft.modelId) || !modelEngineReady(state, catalog.find(m => m.id === draft.modelId))) {
      openSettings(draft.modelId, !state.models.some(m => m.id === draft.modelId) ? 'models' : 'engine'); return;
    }
    run(async () => { await persistDraft(draft); await call('generation.start', draft); });
  };
  // Ctrl/⌘+Enter 在创作页生成，对话框或角色编辑器打开时不响应。
  const generateShortcut = useEffectEvent((event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && page === 'create' && !Array.from(document.querySelectorAll('[role=dialog], [data-character-active=true]')).some(e => e.getClientRects().length > 0)) { event.preventDefault(); generate(); } });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => generateShortcut(event);
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  return generate;
}
