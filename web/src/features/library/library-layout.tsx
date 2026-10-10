import type { CSSProperties, ReactNode } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Search } from 'lucide-react';

export function LibraryPage({ title, actions, controls, query, onQueryChange, searchLabel, empty, noResults, hasItems, hasResults, layout = 'list', children }: {
  title: string; actions?: ReactNode; controls?: ReactNode; query: string; onQueryChange: (query: string) => void;
  searchLabel: string; empty: ReactNode; noResults: string; hasItems: boolean; hasResults: boolean;
  layout?: 'list' | 'tickets'; children: ReactNode;
}) {
  return <VStack className="library-page" gap={6}>
    <HStack className="library-heading" hAlign="between" vAlign="center" wrap="wrap" gap={3}><h1>{title}</h1>{actions}</HStack>
    {controls ? <VStack className="library-controls" gap={0}>{controls}</VStack> : null}
    {hasItems ? <TextInput label={searchLabel} isLabelHidden placeholder={searchLabel} startIcon={<Search />} hasClear value={query} onChange={onQueryChange} /> : null}
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
export function Ticket({ cover, coverClassName = '', eyebrow, title, excerpt, actions, stub, stubActions, className = '', index = 0 }: {
  cover: ReactNode; coverClassName?: string; eyebrow?: ReactNode; title: ReactNode; excerpt?: string; actions?: ReactNode;
  stub?: ReactNode; stubActions?: ReactNode; className?: string; index?: number;
}) {
  return <HStack className={`library-entry ticket ${className}`} gap={0} style={{ '--ticket-index': Math.min(index, 10) } as CSSProperties}>
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
