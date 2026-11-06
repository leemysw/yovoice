import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { subscribeLiveAudio } from '../../shared/lib/bridge';
import type { Activity } from '../../shared/workbench';
import { liveAudioPlayer } from './live-audio-player';

export function LiveAudioNotice({ projectId, page, activity }: { projectId: string; page: string; activity: Activity | null }) {
  const t = useTranslator();
  const [state, setState] = useState({ active: false, error: '' });
  useEffect(() => {
    const unsubscribe = liveAudioPlayer.subscribe(setState);
    const unsubscribeAudio = subscribeLiveAudio(event => liveAudioPlayer.receive(event));
    return () => { unsubscribe(); unsubscribeAudio(); liveAudioPlayer.stop(); };
  }, []);
  useEffect(() => { liveAudioPlayer.setProject(projectId); if (page !== 'create') liveAudioPlayer.stop(); }, [projectId, page]);
  useEffect(() => {
    if (activity?.kind !== 'generate') return;
    if (activity.status === 'failed' || activity.status === 'cancelled') liveAudioPlayer.stop();
  }, [activity?.kind, activity?.status]);
  if (!state.active && !state.error) return null;
  return <HStack className="notice" gap={3} vAlign="center" role="status" data-testid="live-audio-notice">
    <p className="grow">{t(state.error || '@yovoice.runtime.livePlaying')}</p>
    <Button size="sm" label={t(state.error ? '@yovoice.action.closeNotice' : '@yovoice.runtime.stopPreview')} onClick={() => liveAudioPlayer.stop()} />
  </HStack>;
}
