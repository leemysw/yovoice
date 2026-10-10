import type { ReactNode } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';

// 设置页的分组：小标题在上，一组行放在同一张卡片里，行之间用细线分隔。
export function SettingsGroup({ title, description, actions, className = '', children }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode;
}) {
  return <VStack className={`settings-group ${className}`} gap={2}>
    {title || actions ? <HStack className="settings-group-head" hAlign="between" vAlign="end" gap={3} wrap="wrap">
      <VStack gap={1}>{title ? <h3>{title}</h3> : null}{description ? <small>{description}</small> : null}</VStack>
      {actions}
    </HStack> : null}
    <VStack className="settings-rows" gap={0}>{children}</VStack>
  </VStack>;
}

// 一行设置：左侧名称与说明，右侧控件；窄屏时控件换到下一行。
export function SettingsRow({ label, hint, className = '', children }: { label: ReactNode; hint?: ReactNode; className?: string; children?: ReactNode }) {
  return <HStack className={`settings-row ${className}`} hAlign="between" vAlign="center" gap={4} wrap="wrap">
    <VStack className="settings-row-label grow" gap={1}><p className="settings-row-title">{label}</p>{hint ? <small>{hint}</small> : null}</VStack>
    {children ? <HStack className="settings-row-control" gap={2} vAlign="center" wrap="wrap">{children}</HStack> : null}
  </HStack>;
}
