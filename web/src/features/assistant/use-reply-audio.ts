import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslator } from '@astryxdesign/core/i18n';
import { mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import type { Generation } from '../../shared/workbench';

// 助手回复里生成结果的试听：同一时刻最多播放一条，再点一次暂停，面板卸载时停止并释放地址。
// 出错时通过 onError 把已翻译的提示交给面板显示，不在这里持有界面状态。

interface ActivePlayback { element: HTMLAudioElement; id: string; url: string }

// 停下正在试听的回复音频并释放它的地址：暂停、切换到别的结果、卸载都走这里。
function stopPlayback(ref: RefObject<ActivePlayback | null>) {
  const active = ref.current;
  ref.current = null;
  if (!active) return;
  active.element.pause();
  releaseMediaUrl(active.url);
}

/** 返回正在播放的生成结果 ID（没有时为空）与试听/暂停的回调。 */
export function useReplyAudio(onError: (message: string) => void) {
  const t = useTranslator();
  const audioRef = useRef<ActivePlayback | null>(null);
  // 试听请求的序号：快速连点时只有最后一次会播放，卸载后回来的结果直接丢弃。
  const playToken = useRef(0);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { playToken.current++; stopPlayback(audioRef); }, []);

  // 试听回复里的生成结果：再点一次暂停；取地址期间又点了别的或面板已卸载时不再播放，失败时清掉引用并提示。
  const play = async (item: Generation) => {
    const token = ++playToken.current;
    const same = audioRef.current?.id === item.id;
    stopPlayback(audioRef);
    setPlaying(null);
    if (same) return;
    let url: string;
    try { url = await mediaUrl('outputs', item.fileName); }
    catch (e) { if (token === playToken.current) onError(formatCallError(t, e)); return; }
    if (token !== playToken.current) { releaseMediaUrl(url); return; }
    const element = new Audio(url);
    audioRef.current = { element, id: item.id, url };
    setPlaying(item.id);
    element.onended = () => { if (audioRef.current?.element === element) { stopPlayback(audioRef); setPlaying(null); } };
    try { await element.play(); }
    catch (e) {
      if (audioRef.current?.element !== element) return;
      stopPlayback(audioRef);
      setPlaying(null);
      if ((e as DOMException).name !== 'AbortError') onError(t('@yovoice.error.audioPlayFailed'));
    }
  };

  return { playing, play };
}
