import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ResizeHandle, type ResizableProps } from '@astryxdesign/core/Resizable';
import { Button } from '@astryxdesign/core/Button';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AudioLines, Captions, ChevronRight, Mic, Music, Pencil, Settings2, Trash2 } from 'lucide-react';
import { featureHidden, projectKind, type Draft, type ModelPackage, type State } from '../shared/workbench';
import { overflowTitle } from '../shared/ui/overflow-title';
import { UpdateSidebarCard } from '../features/update/update-notice';
import { ModelUpdateSidebarCard } from '../features/settings/model-update-card';
import { readLocal, writeLocal } from '../shared/lib/local-store';

// 侧栏：新建入口、语音生成、语音转写、故事配音、音乐生成、我的声音、最近作品、创作助手与设置。
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
  // 选中底块：一个独立的块放到当前入口下面，换页时从上一个入口滑过去（样式见 app/motion.css）。
  // 位置每次渲染后测量；侧栏宽度或窗口变化时也重新测量。没有选中入口（如我的声音的参考音频页）时淡出。
  const nav = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLElement>(null);
  const place = useRef(() => {});
  place.current = () => {
    const root = nav.current, mark = indicator.current;
    if (!root || !mark) return;
    const selected = root.querySelector<HTMLElement>('.nav-item.selected');
    if (!selected) { mark.dataset.hidden = ''; return; }
    const outer = root.getBoundingClientRect(), box = selected.getBoundingClientRect();
    mark.style.transform = `translate(${box.left - outer.left}px, ${box.top - outer.top}px)`;
    mark.style.width = `${box.width}px`;
    mark.style.height = `${box.height}px`;
    delete mark.dataset.hidden;
    // 第一次定位不做动画，之后的位置变化才滑动。
    if (!('ready' in mark.dataset)) requestAnimationFrame(() => { mark.dataset.ready = ''; });
  };
  useLayoutEffect(() => place.current());
  useEffect(() => {
    const root = nav.current;
    if (!root) return;
    const observer = new ResizeObserver(() => place.current());
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  return <VStack ref={nav} as="nav" className="sidebar" aria-label={t('@yovoice.nav.main')} gap={6} data-testid="sidebar">
    <StackItem ref={indicator} as="span" className="sidebar-indicator" aria-hidden />
    {newDraft}
    <VStack className="sidebar-destinations" gap={2}>
      {/* 顺序：语音生成、语音转写（同属语音）、故事配音、音乐生成，最后是我的声音。 */}
      {(['text', 'transcribe', 'story', 'music'] as const).filter(kind => kind === 'text' || !featureHidden(state.preferences, kind)).map(kind => {
        if (kind === 'transcribe') return <Button key={kind} data-testid="nav-transcribe" label={t('@yovoice.nav.transcribe')} variant="ghost" icon={<Captions />} className={`nav-item ${page === 'transcribe' ? 'selected' : ''}`} aria-current={page === 'transcribe' ? 'page' : undefined} onClick={() => setPage('transcribe')} />;
        // 编曲与音效并入音乐生成：三类作品都高亮「音乐生成」。
        const group = (k: string) => k === 'score' || k === 'sfx' ? 'music' : k;
        const selected = group(page) === kind || (projectActive && group(projectKind(draft)) === kind);
        return <Button key={kind} data-testid={`nav-${kind}`} label={t(`@yovoice.project.${kind}`)} variant="ghost" icon={kind === 'text' ? <Mic /> : kind === 'story' ? <Pencil /> : <Music />} className={`nav-item ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => setPage(kind)} />;
      })}
      <Button data-testid="nav-characters" label={t('@yovoice.nav.characters')} variant="ghost" icon={<AudioLines />} className={`nav-item ${page === 'characters' || page === 'voices' ? 'selected' : ''}`} aria-current={page === 'characters' || page === 'voices' ? 'page' : undefined} onClick={() => setPage('characters')} />
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
