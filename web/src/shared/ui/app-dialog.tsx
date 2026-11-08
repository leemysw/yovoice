import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, VStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { X } from 'lucide-react';
import { MorphFrame } from './morph-frame';

interface AppDialogProps {
  title: string;
  subtitle?: string;
  width?: number;
  busy?: boolean;
  error?: string;
  closeLabel?: string | null;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

// 弹窗内容切换（列表换成选段、出现错误提示等）时，弹窗高度随内容平滑变化。
export function AppDialog({ title, subtitle, width = 400, busy = false, error, closeLabel, onClose, children, actions }: AppDialogProps) {
  const t = useTranslator();
  const label = closeLabel === null ? undefined : (closeLabel || t('@yovoice.action.close'));
  return <Dialog className="app-dialog" isOpen purpose="form" width={width} padding={0} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Layout className="app-dialog-layout" height="auto" padding={6} defaultHasDividers={false}
      header={<DialogHeader className="app-dialog-header" title={title} endContent={label ? <Button label={label} size="sm" isIconOnly variant="ghost" icon={<X />} isDisabled={busy} onClick={onClose} /> : undefined} />}
      content={<LayoutContent><MorphFrame><VStack gap={4} paddingBlockStart={4}>{subtitle ? <p className="muted">{subtitle}</p> : null}{children}{error ? <p className="dialog-error" role="alert">{error}</p> : null}</VStack></MorphFrame></LayoutContent>}
      footer={actions ? <LayoutFooter><HStack className="dialog-actions" gap={2} paddingBlockStart={6} hAlign="end" wrap="wrap">{actions}</HStack></LayoutFooter> : undefined} />
  </Dialog>;
}

export function ConfirmDelete({ title, description, confirmLabel, busy, error, onClose, onConfirm }: {
  title: string; description: string; confirmLabel: string; busy: boolean; error?: string;
  onClose: () => void; onConfirm: () => void;
}) {
  const t = useTranslator();
  return <AppDialog title={title} busy={busy} error={error} onClose={onClose} actions={<>
    <Button label={t('@yovoice.action.cancel')} isDisabled={busy} onClick={onClose} />
    <Button label={confirmLabel} variant="destructive" isLoading={busy} onClick={onConfirm} />
  </>}><p className="helper">{description}</p></AppDialog>;
}
