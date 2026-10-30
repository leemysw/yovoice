import { useCallback, useEffect, useState } from 'react';
import { useResizable } from '@astryxdesign/core/Resizable';
import { call, isDesktop } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { readLocal, removeLocal, writeLocal } from '../shared/lib/local-store';
import { modelTab, type Draft, type ModelPackage } from '../shared/workbench';

// 工作台的导航与面板状态：当前页面与已访问记录、设置页定位、侧栏宽度与收起、右侧检查器的收起与展开。
export function useWorkbenchNavigation({ draft, catalog, setActive, setError }: { draft: Draft; catalog: ModelPackage[]; setActive: (active: boolean) => void; setError: (message: string) => void }) {
  const navigation = useResizable({ defaultSize: 224, minSize: 180, maxSize: 360, collapsible: true, autoSaveId: 'workbench-sidebar' });
  const { isCollapsed, expand, collapse } = navigation;
  const toggleSidebar = useCallback(() => { if (isCollapsed) expand(); else collapse(); }, [isCollapsed, expand, collapse]);
  useEffect(() => {
    window.addEventListener('workbench-toggle-sidebar', toggleSidebar);
    return () => window.removeEventListener('workbench-toggle-sidebar', toggleSidebar);
  }, [toggleSidebar]);
  const [page, setPage] = useState(() => {
    if (isDesktop) {
      const saved = readLocal('yovoice-active-page');
      const listPages = ['text', 'story', 'music', 'score', 'sfx', 'characters', 'settings'];
      return saved && listPages.includes(saved) ? saved : 'text';
    }
    return 'create';
  });
  useEffect(() => {
    writeLocal('yovoice-active-page', page);
  }, [page]);
  // 页面第一次打开时才挂载，之后保持挂载（切走只隐藏），切回来时保留编辑、滚动与播放状态；启动时只渲染当前页。
  const [visited, setVisited] = useState(() => new Set([page]));
  if (!visited.has(page)) setVisited(new Set(visited).add(page));
  // 作品只在编辑页和版本记录页处于打开状态。
  useEffect(() => setActive(page === 'create' || page === 'history'), [page, setActive]);
  const [settingsFocus, setSettingsFocus] = useState<{ tab: string; modelId: string; request: number } | undefined>();
  // 缺的是音色库时打开独立的音色库页，其余模型在“模型”页。
  const openSettings = (modelId = draft.modelId, requested = 'models') => { const family = catalog.find(m => m.id === modelId)?.family; const tab = requested === 'models' && family ? modelTab(family) : requested; setSettingsFocus({ tab, modelId, request: performance.now() }); setPage('settings'); };
  const [showInspector, setShowInspector] = useState(false);
  // 宽屏下右侧检查器的收起状态，跨作品、跨启动保留。
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => readLocal('workbench-inspector-collapsed') === '1');
  const toggleInspector = useCallback(() => setInspectorCollapsed(current => {
    const next = !current;
    writeLocal('workbench-inspector-collapsed', next ? '1' : '0');
    return next;
  }), []);
  // 窗口右上角的右侧面板开关：创作区较窄时检查器已自动收起（见 styles.css 的 studio 容器查询），开关改为展开或收回检查器。
  const toggleInspectorPanel = useCallback(() => {
    // 角色编辑器离开后只隐藏不卸载，它的 .studio 宽度为 0，需取当前可见的创作区。
    const studio = Array.from(document.querySelectorAll<HTMLElement>('.studio')).find(element => element.clientWidth > 0);
    if (studio && studio.clientWidth <= 860) setShowInspector(current => !current);
    else toggleInspector();
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
  return { navigation, isCollapsed, expand, toggleSidebar, page, setPage, visited, settingsFocus, openSettings, showInspector, setShowInspector, inspectorCollapsed, toggleInspectorPanel };
}
