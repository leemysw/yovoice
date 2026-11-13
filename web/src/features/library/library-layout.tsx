import type { CSSProperties, ReactNode, Ref } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Search } from 'lucide-react';
import { withHotkey } from '../../shared/hotkeys/hotkeys';

// hasSearch 默认随 hasItems：列表里只有进行中的任务、还没有可搜的记录时可以单独关掉搜索框。
// pageRef 与 searchRef 供快捷键使用：在本页里找到要试听的卡片、聚焦搜索框；searchKeys 是聚焦搜索的按键文字。
export function LibraryPage({ title, actions, controls, query, onQueryChange, searchLabel, searchKeys, searchAria, empty, noResults, hasItems, hasResults, hasSearch = hasItems, layout = 'list', pageRef, searchRef, children }: {
  title: string; actions?: ReactNode; controls?: ReactNode; query: string; onQueryChange: (query: string) => void;
  searchLabel: string; searchKeys?: string; searchAria?: string; empty: ReactNode; noResults: string; hasItems: boolean; hasResults: boolean; hasSearch?: boolean;
  layout?: 'list' | 'tickets'; pageRef?: Ref<HTMLDivElement>; searchRef?: Ref<HTMLInputElement>; children: ReactNode;
}) {
  return <VStack className="library-page" gap={6} ref={pageRef}>
    <HStack className="library-heading" hAlign="between" vAlign="center" wrap="wrap" gap={3}><h1>{title}</h1>{actions}</HStack>
    {controls ? <VStack className="library-controls" gap={0}>{controls}</VStack> : null}
    {hasSearch ? <TextInput ref={searchRef} label={searchLabel} isLabelHidden placeholder={withHotkey(searchLabel, searchKeys)} aria-keyshortcuts={searchAria} startIcon={<Search />} hasClear value={query} onChange={onQueryChange} /> : null}
    <VStack className={`library-content ${!hasItems ? 'empty-state' : layout === 'tickets' ? 'ticket-list' : 'history-list'}`} gap={0}>
      {!hasItems ? empty : !hasResults ? <p role="status">{noResults}</p> : layout === 'tickets' ? <VStack gap={3}>{children}</VStack> : children}
    </VStack>
  </VStack>;
}

// 空列表：用该列表的封面实物（空白唱片、磁带、声波）代替通用图标，轻轻浮动。
export function LibraryEmpty({ icon, art, title, description, action }: { icon?: ReactNode; art?: ReactNode; title: string; description?: string; action: ReactNode }) {
  return <VStack gap={4} hAlign="center">{art ? <HStack className="empty-art ticket-cover" gap={0} vAlign="center">{art}</HStack> : <HStack className="empty-icon">{icon}</HStack>}<h2>{title}</h2>{description ? <p>{description}</p> : null}{action}</VStack>;
}

// 所有作品与素材列表共用的票根卡片：左边封面，中间元信息、标题和摘录，右边虚线撕口后的存根。
// 封面因类型而异（唱片、磁带、声波），结构、间距和动效保持一致。
// 给了 onSelect 的卡片可被选中：点按或焦点进入时选中，空格试听选中的卡片（itemId 用来在页面里找到它的试听按钮）。
export function Ticket({ cover, coverClassName = '', eyebrow, title, excerpt, actions, stub, stubActions, className = '', index = 0, itemId, selected, onSelect }: {
  cover: ReactNode; coverClassName?: string; eyebrow?: ReactNode; title: ReactNode; excerpt?: string; actions?: ReactNode;
  stub?: ReactNode; stubActions?: ReactNode; className?: string; index?: number; itemId?: string; selected?: boolean; onSelect?: () => void;
}) {
  return <HStack className={`library-entry ticket ${className}`} gap={0} style={{ '--ticket-index': Math.min(index, 10) } as CSSProperties}
    data-ticket-id={itemId} data-selected={onSelect ? !!selected : undefined} onPointerDown={onSelect} onFocus={onSelect}>
    <HStack className="ticket-main grow" gap={4} vAlign="center">
      <HStack className={`ticket-cover ${coverClassName}`} gap={0} vAlign="center">{cover}</HStack>
      <VStack className="grow ticket-body" gap={1}>
        {eyebrow ? <small className="eyebrow">{eyebrow}</small> : null}
        {title}
        {excerpt ? <p className="project-excerpt">「{excerpt}」</p> : null}
      </VStack>
      {actions ? <HStack className="library-entry-actions ticket-inline-actions" gap={1} vAlign="center">{actions}</HStack> : null}
    </HStack>
    <VStack className="ticket-stub" gap={0} hAlign="center" vAlign="center">
      {stub}
      {stubActions ? <HStack className="library-entry-actions ticket-actions" gap={0}>{stubActions}</HStack> : null}
    </VStack>
  </HStack>;
}

// 存根上的大号数字和下面一行小字。
export function TicketStamp({ value, unit }: { value: ReactNode; unit: ReactNode }) {
  return <VStack className="ticket-stamp" gap={0} hAlign="center"><b className="ticket-day">{value}</b><small className="eyebrow">{unit}</small></VStack>;
}

/** 在页面里点一下卡片封面上的试听按钮：试听与停止的状态都在播放器里，这样空格和点按的效果完全一致。 */
export function toggleTicketAudition(page: HTMLElement | null, itemId: string) {
  page?.querySelector<HTMLButtonElement>(`[data-ticket-id="${CSS.escape(itemId)}"] .avatar-toggle`)?.click();
}
