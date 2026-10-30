import { useEffect } from 'react';

// 时间线快捷键：空格播放、撤销重做在页面任意位置生效，其余只在时间线内响应；焦点在输入框、菜单里或有对话框可见时不拦截。
export function useTimelineShortcuts({ blocked, duration, play, restoreEdit, copy, paste, split, remove, seek, selectAll, clearSelection }: {
  blocked: boolean; duration: number; play: () => Promise<void>; restoreEdit: (direction: 'undo' | 'redo') => void;
  copy: () => void; paste: (duplicate?: boolean) => void; split: () => void; remove: (ripple?: boolean) => void;
  seek: (time: number) => void; selectAll: () => void; clearSelection: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (blocked || event.defaultPrevented || event.isComposing || event.altKey) return;
      if ((event.target as Element)?.closest('textarea, input:not([type="range"]), select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"]') || Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(e => e.getClientRects().length > 0)) return;
      const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
      if (key === ' ' && !command) { event.preventDefault(); void play(); return; }
      if (command && (key === 'z' || key === 'y')) { event.preventDefault(); restoreEdit(key === 'y' || event.shiftKey ? 'redo' : 'undo'); return; }
      if (!(event.target as Element)?.closest('.multitrack')) return;
      if (command && key === 'c') { event.preventDefault(); copy(); }
      else if (command && key === 'v') { event.preventDefault(); paste(); }
      else if (command && key === 'd') { event.preventDefault(); paste(true); }
      else if (command && key === 'a') { event.preventDefault(); selectAll(); }
      else if (command && key === 'i') { event.preventDefault(); split(); }
      else if (key === 'delete' || key === 'backspace') { event.preventDefault(); remove(event.shiftKey); }
      else if (key === 'home') { event.preventDefault(); seek(0); }
      else if (key === 'end') { event.preventDefault(); seek(duration); }
      else if (key === 'escape') { clearSelection(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
