import { useEffect, useEffectEvent } from 'react';

// 播放页的键盘控制。播放页是模态弹窗，按键在整个文档上监听，焦点落在哪里都能控制播放和校准：
// 空格播放/暂停；校准时下箭头或回车标记、退格撤销；其余时候左右箭头快退/快进，有上一个版本时按 B 来回切换。
export function useNowPlayingKeys({ wake, editing, syncing, toggle, mark, undo, switchBack, rewind, forward }: {
  wake: () => void; editing: boolean; syncing: boolean; toggle: () => void; mark: () => void; undo: () => void; switchBack: (() => void) | null; rewind: () => void; forward: () => void;
}) {
  const keys = useEffectEvent((event: globalThis.KeyboardEvent) => {
    wake();
    if (event.target instanceof HTMLInputElement || (event.key === ' ' || event.key === 'Enter') && event.target instanceof HTMLButtonElement) return;
    if (editing) { if (event.key === ' ') { event.preventDefault(); toggle(); } return; }
    const action = event.key === ' ' ? toggle
      : syncing && (event.key === 'ArrowDown' || event.key === 'Enter') ? mark
        : syncing && event.key === 'Backspace' ? undo
          : !syncing && switchBack && (event.key === 'b' || event.key === 'B') ? switchBack
            : !syncing && event.key === 'ArrowLeft' ? rewind
            : !syncing && event.key === 'ArrowRight' ? forward : null;
    if (!action) return;
    event.preventDefault(); action();
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => keys(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
}
