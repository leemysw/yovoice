import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ResizeHandle, type ResizableProps } from '@astryxdesign/core/Resizable';
import { useTranslator } from '@astryxdesign/core/i18n';
import { PanelRightClose, PanelRightOpen, SlidersHorizontal } from 'lucide-react';

// 创作页：左侧正文，右侧检查器。宽屏下检查器可收起；创作区较窄时检查器自动收起。收起后主操作移到标题栏，正文独占宽度。
// 传入 resizeInspector 时，检查器左边缘可拖动调整宽度（检查器浮出或收起时不显示拖动条）。
// 作品页由窗口右上角的开关展开检查器，不在正文里另加按钮；没有该开关的页面（如角色）传入 onShowInspector 显示正文内按钮。
export function Studio({ title, actions, inspector, showInspector, onShowInspector, inspectorCollapsed, onToggleInspector, collapsedAction, resizeInspector, writingClassName = '', children }: {
  title: ReactNode; actions?: ReactNode; inspector: ReactNode; showInspector: boolean;
  onShowInspector?: () => void; inspectorCollapsed?: boolean; onToggleInspector?: () => void; collapsedAction?: ReactNode; resizeInspector?: ResizableProps;
  writingClassName?: string; children: ReactNode;
}) {
  const t = useTranslator();
  return <HStack className={`studio ${showInspector ? 'show-inspector' : ''} ${inspectorCollapsed ? 'collapse-inspector' : ''}`} gap={0}>
    <VStack as="section" className="document" gap={0}>
      <VStack className={`writing ${writingClassName}`} gap={0}>
        <HStack className="document-heading" gap={3} vAlign="center">
          {title}{actions}
          {collapsedAction ? <HStack className="inspector-collapsed-action" gap={0} vAlign="center">{collapsedAction}</HStack> : null}
          {onToggleInspector ? <Button label={t(inspectorCollapsed ? '@yovoice.app.expandInspector' : '@yovoice.app.collapseInspector')} className="inspector-collapse" isIconOnly variant="ghost"
            icon={inspectorCollapsed ? <PanelRightOpen /> : <PanelRightClose />} aria-expanded={!inspectorCollapsed} onClick={onToggleInspector} /> : null}
          {onShowInspector ? <Button label={t('@yovoice.app.voiceSettings')} className="inspector-toggle" isIconOnly icon={<SlidersHorizontal />} variant="ghost" onClick={onShowInspector} /> : null}
        </HStack>
        {children}
      </VStack>
    </VStack>
    {resizeInspector ? <ResizeHandle className="inspector-resize" label={t('@yovoice.app.resizeInspector')} direction="horizontal" position="overlay" pillPlacement="center" isReversed resizable={resizeInspector} isAlwaysVisible={false} /> : null}
    {inspector}
  </HStack>;
}
