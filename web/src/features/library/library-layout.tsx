import type { ReactNode } from 'react';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Search } from 'lucide-react';

export function LibraryPage({ title, actions, controls, query, onQueryChange, searchLabel, empty, noResults, hasItems, hasResults, layout = 'list', children }: {
  title: string; actions?: ReactNode; controls?: ReactNode; query: string; onQueryChange: (query: string) => void;
  searchLabel: string; empty: ReactNode; noResults: string; hasItems: boolean; hasResults: boolean;
  layout?: 'grid' | 'list' | 'tickets'; children: ReactNode;
}) {
  return <VStack className="library-page" gap={6}>
    <HStack className="library-heading" hAlign="between" vAlign="center" wrap="wrap" gap={3}><h1>{title}</h1>{actions}</HStack>
    {controls ? <VStack className="library-controls" gap={0}>{controls}</VStack> : null}
    {hasItems ? <TextInput label={searchLabel} isLabelHidden placeholder={searchLabel} startIcon={<Search />} hasClear value={query} onChange={onQueryChange} /> : null}
    <VStack className={`library-content ${!hasItems ? 'empty-state' : layout === 'grid' ? 'voice-library-list' : layout === 'tickets' ? 'ticket-list' : 'history-list'}`} gap={0}>
      {!hasItems ? empty : !hasResults ? <p role="status">{noResults}</p> : layout === 'grid' ? <Grid columns={{ minWidth: 280, max: 4 }} gap={4} align="start">{children}</Grid> : layout === 'tickets' ? <VStack gap={3}>{children}</VStack> : children}
    </VStack>
  </VStack>;
}

export function LibraryEmpty({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action: ReactNode }) {
  return <VStack gap={4} hAlign="center"><HStack className="empty-icon">{icon}</HStack><h2>{title}</h2>{description ? <p>{description}</p> : null}{action}</VStack>;
}

export function LibraryEntry({ avatar, title, metadata, description, actions }: { avatar: ReactNode; title: string; metadata?: ReactNode; description?: string; actions: ReactNode }) {
  return <HStack className="library-entry" gap={3} vAlign="center">
    {avatar}
    <VStack className="library-entry-body" gap={2}>
      <HStack gap={2} hAlign="between" vAlign="center"><h3 title={title}>{title}</h3>{metadata}</HStack>
      {description ? <p className="library-description" title={description}>{description}</p> : null}
      <HStack className="library-entry-actions" gap={1} vAlign="center" wrap="wrap">{actions}</HStack>
    </VStack>
  </HStack>;
}
