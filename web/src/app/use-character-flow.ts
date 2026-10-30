import { useRef, useState } from 'react';
import type { TranslatorFn } from '@astryxdesign/core/i18n';
import { createDraft, newId, synthesisSettings, type Character, type Draft, type Generation, type State } from '../shared/workbench';
import type { DraftSession } from './use-draft-session';
import type { StoryCueEditing } from './use-story-cue-editing';

// 角色（声音）编辑流程：从检查器、历史版本或声音库进入角色编辑器，保存后回到来源页，并把角色套用到当前作品或指定作品的说话人。
export function useCharacterFlow({ t, state, page, setPage, session, newDraft, projectList, cues }: {
  t: TranslatorFn; state: State; page: string; setPage: (page: string) => void;
  session: Pick<DraftSession, 'draft' | 'setDraft' | 'change' | 'persistDraft'>;
  newDraft: (next: Draft) => Promise<void>; projectList: Draft[];
  cues: Pick<StoryCueEditing, 'activeSpeaker' | 'inspectorDraft' | 'setCueSelection'>;
}) {
  const { draft, setDraft, change, persistDraft } = session;
  const { activeSpeaker, inspectorDraft, setCueSelection } = cues;
  const [characterEditor, setCharacterEditor] = useState<Character | null>(null);
  const characterActive = !!characterEditor && page === 'characters';
  const characterReturnPage = useRef('create');
  const characterOrigin = useRef<{ draftId: string; speakerId: string } | null>(null);
  const selectedCharacter = draft.characterId ?? null;
  const applyCharacter = (c: Character) => {
    if (activeSpeaker) {
      setDraft(current => ({ ...current, subtitles: { ...current.subtitles!, cues: current.subtitles!.cues.map(cue => cue.speakerId === activeSpeaker.id ? { ...cue, performance: undefined } : cue), speakers: current.subtitles!.speakers.map(s => s.id === activeSpeaker.id ? { ...s, characterId: c.id, settings: structuredClone(c.settings) } : s) } }));
    } else { change({ ...c.settings, characterId: c.id, performance: undefined }); }
  };
  const editCharacter = (character: Character) => { if (characterEditor) { setPage('characters'); return; } characterOrigin.current = page === 'create' ? { draftId: draft.id, speakerId: activeSpeaker?.id ?? '' } : null; characterReturnPage.current = page; setCharacterEditor(character); setPage('characters'); };
  const openCharacter = () => {
    editCharacter({ id: newId(), name: activeSpeaker?.sourceName || draft.title, settings: synthesisSettings(inspectorDraft), demoText: t('@yovoice.character.example') });
  };
  // 把一条生成结果用到的声音设置存为角色：模型、参考音色、声音设计描述和全部参数一起带上，在角色编辑器里确认后保存。
  const characterFromGeneration = (item: Generation) => editCharacter({ id: newId(), name: item.title, settings: structuredClone(synthesisSettings(item.settings)), demoText: item.settings.text.slice(0, 120) || t('@yovoice.character.example') });
  const createVoice = () => {
    const defaults = createDraft(false, state.preferences.uiLocale);
    editCharacter({ id: newId(), name: t('@yovoice.library.newVoice'), settings: synthesisSettings({ ...defaults, modelId: state.models.find(m => m.id.startsWith('omnivoice-'))?.id ?? 'omnivoice-q8', voiceMode: 'design' }), demoText: t('@yovoice.character.example') });
  };
  // 声音库里点「套用」后弹出的目标作品选择。
  const [voiceTarget, setVoiceTarget] = useState<Character | null>(null);
  async function applyToTarget(voice: Character, draftId: string, speakerId: string) {
    const source = draftId === 'new' ? { ...createDraft(false, state.preferences.uiLocale), kind: 'text' as const } : projectList.find(d => d.id === draftId);
    if (!source || (source.subtitles && !source.subtitles.speakers.some(s => s.id === speakerId))) throw new Error('@yovoice.error.draftIDInvalid');
    const next = source.subtitles ? { ...source, subtitles: { ...source.subtitles, cues: source.subtitles.cues.map(cue => cue.speakerId === speakerId ? { ...cue, performance: undefined } : cue), speakers: source.subtitles.speakers.map(s => s.id === speakerId ? { ...s, characterId: voice.id, settings: structuredClone(voice.settings) } : s) } } : { ...source, ...structuredClone(voice.settings), characterId: voice.id, performance: undefined };
    if (draftId === draft.id) { await persistDraft(next); setDraft(next); setPage('create'); }
    else await newDraft(next);
    if (next.subtitles) setCueSelection(current => ({ draftId: next.id, index: Math.max(0, next.subtitles!.cues.findIndex(c => c.speakerId === speakerId)), revision: (current?.revision ?? 0) + 1 }));
  }
  return { characterEditor, setCharacterEditor, characterActive, characterReturnPage, characterOrigin, selectedCharacter, applyCharacter, editCharacter, openCharacter, characterFromGeneration, createVoice, voiceTarget, setVoiceTarget, applyToTarget };
}
