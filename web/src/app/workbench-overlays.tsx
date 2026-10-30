import { lazy, Suspense, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslator } from '@astryxdesign/core/i18n';
import { VoiceTarget } from '../features/library/voice-target';
import { VoiceEditor } from '../features/library/voice-editor';
import { SelectionAction, type TextSelection } from '../features/create/selection-action';
import { UpdateDialogHost } from '../features/update/update-dialog';
import { UpdateNotice } from '../features/update/update-notice';
import { ConfirmDelete } from '../shared/ui/app-dialog';
import { PageBoundary } from '../shared/ui/page-boundary';
import { call } from '../shared/lib/client';
import { formatNotice } from '../shared/i18n/format';
import { isAligner, isIndexModel, type Character, type Draft, type Generation, type ModelPackage, type State, type Voice } from '../shared/workbench';
import { Notifications } from './notifications';
import { PronunciationDialog, type Pronunciation } from './pronunciation-dialog';
import type { DraftSession } from './use-draft-session';
import type { StoryCueEditing } from './use-story-cue-editing';
// 浮层按需加载：音乐播放页、声音选择、开场画面与功能引导只在用到时取回。
const NowPlaying = lazy(() => import('../features/music/now-playing').then(module => ({ default: module.NowPlaying })));
const IntroScreen = lazy(() => import('./intro-screen').then(module => ({ default: module.IntroScreen })));
const GuideTour = lazy(() => import('./guide-tour').then(module => ({ default: module.GuideTour })));
const VoicePicker = lazy(() => import('../features/media/voice-picker').then(module => ({ default: module.VoicePicker })));

export type VoicePickerMode = 'voice' | 'emotion' | 'add' | null;

// 工作台之上的各个浮层：通知、更新、选中文字的操作、角色套用目标、删除确认、播放页、声音编辑与选择、读音、开场画面与功能引导。
// 每个浮层各自包一层边界：任一处渲染出错只影响它自己，工作区照常可用。
export function WorkbenchOverlays({ state, catalog, ready, error, setError, page, run, session, selectDraft, instrumental, voicePicker, setVoicePicker, editor, pronunciation, setPronunciation, voiceTarget, setVoiceTarget, projectList, applyToTarget, nowPlaying, setNowPlaying, openSettings, voiceEditor, setVoiceEditor, cues, showIntro, finishIntro, showTour, finishTour }: {
  state: State; catalog: ModelPackage[]; ready: boolean; error: string; setError: (message: string) => void; page: string; run: (action: () => Promise<unknown>) => void;
  session: Pick<DraftSession, 'draft' | 'change' | 'deleteTarget' | 'setDeleteTarget' | 'deleting' | 'deleteError' | 'deleteDraft'>; selectDraft: (item: Draft) => void; instrumental: boolean;
  voicePicker: VoicePickerMode; setVoicePicker: (picker: VoicePickerMode) => void; editor: RefObject<HTMLTextAreaElement | null>;
  pronunciation: Pronunciation | null; setPronunciation: Dispatch<SetStateAction<Pronunciation | null>>;
  voiceTarget: Character | null; setVoiceTarget: (voice: Character | null) => void; projectList: Draft[]; applyToTarget: (voice: Character, draftId: string, speakerId: string) => Promise<void>;
  nowPlaying: Generation | null; setNowPlaying: (item: Generation | null) => void; openSettings: (modelId?: string, requested?: string) => void;
  voiceEditor: Voice | Generation | null; setVoiceEditor: (item: Voice | Generation | null) => void;
  cues: Pick<StoryCueEditing, 'activeSpeaker' | 'changeSpeaker'>;
  showIntro: boolean; finishIntro: () => void; showTour: boolean; finishTour: () => void;
}) {
  const t = useTranslator();
  const { draft, change, deleteTarget, setDeleteTarget, deleting, deleteError, deleteDraft } = session;
  const { activeSpeaker, changeSpeaker } = cues;
  const activity = state.activity;
  function selectVoice(voice: Voice) { if (voicePicker !== 'add') change(voicePicker === 'emotion' ? { emotionVoiceId: voice.id } : { voiceId: voice.id, referenceText: voice.referenceText ?? '' }); setVoicePicker(null); }
  function annotate(selection: TextSelection) {
    setPronunciation({ ...selection, sound: '' });
  }
  return <>
    <PageBoundary name="notifications" resetKey={error}><Notifications error={error} clearError={() => setError('')} activity={activity} modelActivity={state.modelActivity} draftId={draft.id} page={page} cancel={() => run(() => call('operation.cancel'))} cancelModel={() => run(() => call('model.cancel'))}
      aiTask={state.aiTask} aiTitle={state.drafts.find(item => item.id === state.aiTask?.projectId)?.title} openAITask={() => { const target = state.drafts.find(item => item.id === state.aiTask?.projectId); if (target) selectDraft(target); }}><UpdateNotice /></Notifications></PageBoundary>
    <PageBoundary name="update-dialog"><UpdateDialogHost /></PageBoundary>
    {ready && !draft.subtitles && !instrumental && isIndexModel(draft.modelId) && page === 'create' && !voicePicker && !pronunciation && !deleteTarget ? <PageBoundary name="selection-action"><SelectionAction key={draft.id} editor={editor} onEdit={annotate} /></PageBoundary> : null}

    {voiceTarget ? <PageBoundary name="voice-target"><VoiceTarget voice={voiceTarget} drafts={projectList} apply={applyToTarget} close={() => setVoiceTarget(null)} /></PageBoundary> : null}
    {deleteTarget ? <ConfirmDelete title={t('@yovoice.app.deleteProjectTitle')} description={t('@yovoice.app.deleteProjectBody', { title: deleteTarget.title })}
      confirmLabel={t('@yovoice.app.deleteProjectConfirm')} busy={deleting} error={formatNotice(t, deleteError)} onClose={() => setDeleteTarget(null)} onConfirm={() => void deleteDraft()} /> : null}
    {nowPlaying ? <PageBoundary name="now-playing"><Suspense fallback={null}><NowPlaying item={nowPlaying} title={nowPlaying.title} versions={state.history.filter(item => item.settings.id === nowPlaying.settings.id && !item.segment)}
      aligner={state.models.some(model => isAligner(model.id))} activity={activity} getAligner={() => { setNowPlaying(null); openSettings(catalog.find(model => model.family === 'lyric_align')?.id, 'models'); }} close={() => setNowPlaying(null)} /></Suspense></PageBoundary> : null}
    {voiceEditor ? <PageBoundary name="voice-editor"><VoiceEditor item={voiceEditor} close={() => setVoiceEditor(null)} /></PageBoundary> : null}
    {voicePicker ? <PageBoundary name="voice-picker"><Suspense fallback={<p role="status">{t('@yovoice.app.loadingVoicePicker')}</p>}><VoicePicker adding={voicePicker === 'add'} voices={state.voices} onClose={() => setVoicePicker(null)} onSelect={voice => { if ((activeSpeaker || draft.performance) && voicePicker !== 'add') { changeSpeaker(voicePicker === 'emotion' ? { emotionVoiceId: voice.id } : { voiceId: voice.id, referenceText: voice.referenceText ?? '' }); setVoicePicker(null); } else selectVoice(voice); }} /></Suspense></PageBoundary> : null}
    {pronunciation ? <PageBoundary name="pronunciation"><PronunciationDialog pronunciation={pronunciation} setPronunciation={setPronunciation} draft={draft} change={change} editor={editor} /></PageBoundary> : null}
    {showIntro ? <PageBoundary name="intro"><Suspense fallback={null}><IntroScreen onStart={finishIntro} /></Suspense></PageBoundary> : null}
    {showTour ? <PageBoundary name="tour"><Suspense fallback={null}><GuideTour hidden={state.preferences.hiddenFeatures} onClose={finishTour} /></Suspense></PageBoundary> : null}
  </>;
}
