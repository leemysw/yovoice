import { useState, type ReactNode } from 'react';
import { ResizeHandle, type ResizableProps } from '@astryxdesign/core/Resizable';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AudioLines, Captions, ChevronRight, Mic, Music, Pencil, Settings2, Trash2 } from 'lucide-react';
import { featureHidden, projectKind, type Draft, type ModelPackage, type State } from '../shared/workbench';
import { overflowTitle } from '../shared/ui/overflow-title';
import { UpdateSidebarCard } from '../features/update/update-notice';
import { ModelUpdateSidebarCard } from '../features/settings/model-update-card';
import { readLocal, writeLocal } from '../shared/lib/local-store';

// 侧栏：新建入口、作品类型、声音库、语音转写、最近作品、创作助手与设置。
export function SidebarNav(props: {
  page: string;
  setPage: (id: string) => void;
  newDraft: ReactNode;
  state: State;
  catalog: ModelPackage[];
  catalogRevision: string;
  openSettings: (modelId: string) => void;
  draft: Draft;
  selectDraft: (item: Draft) => void;
  removeDraft: (item: Draft) => void;
  resizable: ResizableProps;
}) {
  const t = useTranslator();
  const { page, setPage, newDraft, state, catalog, catalogRevision, openSettings, draft, selectDraft, removeDraft, resizable } = props;
  const [recentOpen, setRecentOpen] = useState(() => readLocal('yovoice-recent-open') !== 'false');
  const projectActive = page === 'create' || page === 'history';
  return <VStack as="nav" className="sidebar" aria-label={t('@yovoice.nav.main')} gap={6} data-testid="sidebar">
    {newDraft}
    <VStack className="sidebar-destinations" gap={2}>
      {(['text', 'story', 'music'] as const).filter(kind => kind === 'text' || !featureHidden(state.preferences, kind)).map(kind => {
        // 编曲与音效并入音乐生成：三类作品都高亮「音乐生成」。
        const group = (k: string) => k === 'score' || k === 'sfx' ? 'music' : k;
        const selected = group(page) === kind || (projectActive && group(projectKind(draft)) === kind);
        return <Button key={kind} data-testid={`nav-${kind}`} label={t(`@yovoice.project.${kind}`)} variant="ghost" icon={kind === 'text' ? <Mic /> : kind === 'story' ? <Pencil /> : <Music />} className={`nav-item ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => setPage(kind)} />;
      })}
      <Button data-testid="nav-characters" label={t('@yovoice.nav.characters')} variant="ghost" icon={<AudioLines />} className={`nav-item ${page === 'characters' || page === 'voices' ? 'selected' : ''}`} aria-current={page === 'characters' || page === 'voices' ? 'page' : undefined} onClick={() => setPage('characters')} />
      {featureHidden(state.preferences, 'transcribe') ? null : <Button data-testid="nav-transcribe" label={t('@yovoice.nav.transcribe')} variant="ghost" icon={<Captions />} className={`nav-item ${page === 'transcribe' ? 'selected' : ''}`} aria-current={page === 'transcribe' ? 'page' : undefined} onClick={() => setPage('transcribe')} />}
    </VStack>
    <details className="recent-projects" open={recentOpen}>
      <summary onClick={event => { event.preventDefault(); const open = !recentOpen; setRecentOpen(open); writeLocal('yovoice-recent-open', String(open)); }}><ChevronRight aria-hidden />{t('@yovoice.nav.recent')}</summary>
      <VStack className="project-list" gap={1}>{[...state.drafts].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 5).map(item => <HStack key={item.id} className={`project-row ${item.id === draft.id && page === 'create' ? 'current' : ''}`} gap={0}>
        <Button label={item.id === draft.id ? draft.title : item.title} variant="ghost" size="sm" className="project-link grow" onPointerEnter={overflowTitle} aria-current={item.id === draft.id && page === 'create' ? 'page' : undefined} onClick={() => selectDraft(item)} />
        <Button className="project-quick-delete" label={t('@yovoice.nav.deleteProject', { title: item.id === draft.id ? draft.title : item.title })} icon={<Trash2 />} isIconOnly size="sm" variant="ghost" onClick={() => removeDraft(item.id === draft.id ? draft : item)} />
      </HStack>)}</VStack>
    </details>
    <VStack className="sidebar-bottom" gap={3}><ModelUpdateSidebarCard state={state} catalog={catalog} revision={catalogRevision} openSettings={openSettings} /><UpdateSidebarCard />
      <Button data-testid="nav-settings" label={t('@yovoice.nav.settings')} icon={<Settings2 size={18} />} variant="ghost" className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')} /></VStack>
    <ResizeHandle label={t('@yovoice.nav.resize')} direction="horizontal" position="overlay" pillPlacement="center" resizable={resizable} isAlwaysVisible={false} />
  </VStack>;
}
