import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, VStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { X } from 'lucide-react';

interface AppDialogProps {
  title: string;
  subtitle?: string;
  width?: number;
  busy?: boolean;
  error?: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

export function AppDialog({ title, subtitle, width = 400, busy = false, error, closeLabel, onClose, children, actions }: AppDialogProps) {
  return <Dialog className="app-dialog" isOpen purpose="form" width={width} padding={0} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Layout className="app-dialog-layout" height="auto" padding={6} defaultHasDividers={false}
      header={<DialogHeader className="app-dialog-header" title={title} endContent={closeLabel ? <Button label={closeLabel} size="sm" isIconOnly variant="ghost" icon={<X />} isDisabled={busy} onClick={onClose} /> : undefined} />}
      content={<LayoutContent><VStack gap={4} paddingBlockStart={4}>{subtitle ? <p className="muted">{subtitle}</p> : null}{children}{error ? <p className="dialog-error" role="alert">{error}</p> : null}</VStack></LayoutContent>}
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
