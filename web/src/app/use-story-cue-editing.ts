import { useState } from 'react';
import { cueSettings, performanceSettings, synthesisSettings, type Draft } from '../shared/workbench';
import type { DraftSession } from './use-draft-session';

// 故事配音的台词与说话人编辑：当前选中的台词、它所属的说话人、检查器展示的合成参数，以及只改当前句或当前说话人的修改。
export function useStoryCueEditing({ draft, setDraft, setDraftPersisted, page }: Pick<DraftSession, 'draft' | 'setDraft' | 'setDraftPersisted'> & { page: string }) {
  const [playingCue, setPlayingCue] = useState(-1);
  const [cueSelection, setCueSelection] = useState<{ draftId: string; index: number; revision: number } | null>(null);
  const selectedCue = cueSelection?.draftId === draft.id ? Math.min(cueSelection.index, (draft.subtitles?.cues.length ?? 1) - 1) : 0;
  // 故事配音里选中的台词随上下文带上，Ocho 据此理解“这句”。
  const focusCue = page === 'create' && draft.subtitles?.cues.length ? (() => {
    const cue = draft.subtitles.cues[selectedCue];
    return { index: selectedCue + 1, total: draft.subtitles.cues.length, speaker: draft.subtitles.speakers.find(item => item.id === cue.speakerId)?.sourceName, text: cue.text };
  })() : undefined;
  const activeCue = draft.subtitles?.cues[selectedCue];
  const activeSpeaker = draft.subtitles?.speakers.find(speaker => speaker.id === activeCue?.speakerId) ?? draft.subtitles?.speakers[0];
  const inspectorDraft = activeSpeaker ? { ...draft, ...(activeCue ? cueSettings(draft, activeCue) : activeSpeaker.settings), text: activeCue?.text ?? '' } : draft;
  const selectCue = (index: number) => setCueSelection(current => ({ draftId: draft.id, index, revision: (current?.revision ?? 0) + 1 }));
  // 已选演绎只修改当前句子的快照，默认参数仍归当前说话人。
  const changeSpeaker = (patch: Partial<Draft>) => { setDraftPersisted(true); setDraft(current => {
    if (!activeSpeaker || !current.subtitles || current.id !== draft.id) return { ...current, ...patch, performance: current.performance ? { ...current.performance, settings: synthesisSettings({ ...current, ...patch }) } : undefined };
    const { text, ...settings } = patch;
    if (activeCue?.performance) {
      const cues = current.subtitles.cues.map((cue, index) => index === selectedCue ? { ...cue, text: text ?? cue.text, performance: { ...cue.performance!, settings: performanceSettings(activeSpeaker.settings ?? synthesisSettings(current), { ...cue.performance!, settings: { ...cueSettings(current, cue), ...settings } }) } } : cue);
      const joined = cues.map(c => c.text).join('\n');
      return joined.length > 12000 ? current : { ...current, text: joined, subtitles: { ...current.subtitles, cues } };
    }
    const cues = current.subtitles.cues.map((cue, index) => index === selectedCue && text !== undefined ? { ...cue, text } : cue);
    const joined = cues.map(cue => cue.text).join('\n');
    if (joined.length > 12000) return current;
    return { ...current, text: joined, subtitles: { ...current.subtitles, cues, speakers: current.subtitles.speakers.map(speaker => speaker.id === activeSpeaker.id && Object.keys(settings).length ? { ...speaker, settings: synthesisSettings({ ...current, ...speaker.settings, ...settings }) } : speaker) } };
  }); };
  return { playingCue, setPlayingCue, cueSelection, setCueSelection, selectedCue, focusCue, activeCue, activeSpeaker, inspectorDraft, selectCue, changeSpeaker };
}

export type StoryCueEditing = ReturnType<typeof useStoryCueEditing>;
