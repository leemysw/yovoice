import { useCallback, useEffect, useRef, useState } from 'react';
import { useResizable } from '@astryxdesign/core/Resizable';
import { call, isDesktop } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { readLocal, removeLocal, writeLocal } from '../shared/lib/local-store';
import { hasTransitionSource, withViewTransition } from '../shared/lib/view-transition';
import { featureHidden, modelTab, type Draft, type ModelPackage, type Preferences } from '../shared/workbench';

// 工作台的导航与面板状态：当前页面与已访问记录、设置页定位、侧栏宽度与收起、右侧检查器的收起与展开。
export function useWorkbenchNavigation({ draft, catalog, preferences, setActive, setError }: { draft: Draft; catalog: ModelPackage[]; preferences: Preferences; setActive: (active: boolean) => void; setError: (message: string) => void }) {
  const navigation = useResizable({ defaultSize: 224, minSize: 180, maxSize: 360, collapsible: true, autoSaveId: 'workbench-sidebar' });
  const { isCollapsed, expand, collapse } = navigation;
  // 侧栏收起展开用视图过渡：侧栏滑出、右侧整张工作区随左边缘一起移动，而不是瞬间跳宽。
  const toggleSidebar = useCallback(() => withViewTransition(() => { if (isCollapsed) expand(); else collapse(); }, 'sidebar'), [isCollapsed, expand, collapse]);
  useEffect(() => {
    window.addEventListener('workbench-toggle-sidebar', toggleSidebar);
    return () => window.removeEventListener('workbench-toggle-sidebar', toggleSidebar);
  }, [toggleSidebar]);
  const [page, setPageNow] = useState(() => {
    if (isDesktop) {
      const saved = readLocal('yovoice-active-page');
      const listPages = ['text', 'story', 'music', 'score', 'sfx', 'characters', 'transcribe', 'settings'];
      return saved && listPages.includes(saved) ? saved : 'text';
    }
    return 'create';
  });
  useEffect(() => {
    writeLocal('yovoice-active-page', page);
  }, [page]);
  // 换页统一经过视图过渡：侧栏选中块滑到新入口、旧页淡出新页淡入；从作品卡片打开时标题飞成作品标题。
  // 已在目标页时不发起过渡，避免无变化的过渡拦住一次点击。
  const current = useRef(page);
  current.current = page;
  const setPage = useCallback((next: string) => {
    if (next === current.current) { setPageNow(next); return; }
    withViewTransition(() => setPageNow(next), hasTransitionSource() ? 'open-project' : 'page');
  }, []);
  // 所在页面的功能在设置里被隐藏（或上次停留的页面已隐藏、助手跳转到隐藏页面）时回到语音生成。
  const pageFeature = page === 'story' ? 'story' : page === 'music' || page === 'score' || page === 'sfx' ? 'music' : page === 'transcribe' ? 'transcribe' : null;
  if (pageFeature && featureHidden(preferences, pageFeature)) setPageNow('text');
  // 页面第一次打开时才挂载，之后保持挂载（切走只隐藏），切回来时保留编辑、滚动与播放状态；启动时只渲染当前页。
  const [visited, setVisited] = useState(() => new Set([page]));
  if (!visited.has(page)) setVisited(new Set(visited).add(page));
  // 作品只在编辑页和版本记录页处于打开状态。
  useEffect(() => setActive(page === 'create' || page === 'history'), [page, setActive]);
  const [settingsFocus, setSettingsFocus] = useState<{ tab: string; modelId: string; request: number } | undefined>();
  // 缺的是音色库时打开独立的音色库页，其余模型在“模型”页。
  const openSettings = (modelId = draft.modelId, requested = 'models') => { const family = catalog.find(m => m.id === modelId)?.family; const tab = requested === 'models' && family ? modelTab(family) : requested; setSettingsFocus({ tab, modelId, request: performance.now() }); setPage('settings'); };
  const [showInspector, setShowInspector] = useState(false);
  // 右侧检查器的宽度可拖动调整并记在本机，选项文字较长的语言可以拉宽面板看全；窄屏浮出时沿用同一宽度。
  const inspectorPanel = useResizable({ defaultSize: 352, minSize: 320, maxSize: 560, autoSaveId: 'workbench-inspector' });
  // 宽屏下右侧检查器的收起状态，跨作品、跨启动保留。
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => readLocal('workbench-inspector-collapsed') === '1');
  const toggleInspector = useCallback(() => setInspectorCollapsed(current => {
    const next = !current;
    writeLocal('workbench-inspector-collapsed', next ? '1' : '0');
    return next;
  }), []);
  // 窗口右上角的右侧面板开关：创作区较窄时检查器已自动收起（见 styles.css 的 studio 容器查询），开关改为展开或收回检查器。
  // 右侧面板收起时滑出、正文随之变宽，“生成”按钮从面板顶部移到标题栏（展开时反向）；窄屏浮出同样滑入。
  const toggleInspectorPanel = useCallback(() => {
    // 角色编辑器离开后只隐藏不卸载，它的 .studio 宽度为 0，需取当前可见的创作区。
    const studio = Array.from(document.querySelectorAll<HTMLElement>('.studio')).find(element => element.clientWidth > 0);
    withViewTransition(() => {
      if (studio && studio.clientWidth <= 860) setShowInspector(current => !current);
      else toggleInspector();
    }, 'inspector');
  }, [toggleInspector]);
  useEffect(() => {
    // 只有工作区有右侧面板；列表、设置等页面忽略开关，不跳回上次的作品。
    const handleToggle = () => { if (page === 'create') toggleInspectorPanel(); };
    window.addEventListener('workbench-toggle-inspector', handleToggle);
    return () => window.removeEventListener('workbench-toggle-inspector', handleToggle);
  }, [page, toggleInspectorPanel]);
  // 标题栏的右侧面板开关由宿主绘制：离开工作区时让宿主隐藏它。
  useEffect(() => { if (isDesktop) void call('inspector.available', { available: page === 'create' }).catch(() => undefined); }, [page]);
  // 侧栏宽度由 useResizable 记在本机，桌面端再同步给宿主绘制标题栏；记录损坏时删掉它跳过，不让每次启动都卡在这里。
  useEffect(() => {
    const key = 'astryx-resizable:workbench-sidebar';
    const saved = readLocal(key);
    if (!saved) return;
    let layout: unknown;
    try { layout = JSON.parse(saved); } catch { removeLocal(key); return; }
    if (isDesktop) void call('sidebar.save', layout).catch(error => setError(noticeMessage(error)));
  }, [navigation.size, navigation.isCollapsed, setError]);
  // 窄屏浮出的面板用“关闭”收起时也走同一过渡。
  const showInspectorPanel = useCallback((show: boolean) => withViewTransition(() => setShowInspector(show), 'inspector'), []);
  return { navigation, inspectorPanel, isCollapsed, expand, toggleSidebar, page, setPage, visited, settingsFocus, openSettings, showInspector, setShowInspector: showInspectorPanel, inspectorCollapsed, toggleInspectorPanel };
}
