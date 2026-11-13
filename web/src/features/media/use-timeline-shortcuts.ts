import { useEffect } from 'react';
import { composing, dialogOpen, platform, typingTarget } from '../../shared/hotkeys/hotkeys';
import { eventBindings, historyAction } from '../../shared/hotkeys/keys';

// 时间线的固定按键（不能在设置里修改）：撤销重做在页面任意位置生效，复制粘贴、全选、删除与 Esc 只在时间线内响应；
// 焦点在输入框、菜单里，正在用输入法组字或有对话框可见时不拦截。可修改的命令（播放、分割、缩放等）在 TimelineEditor 里用 useHotkey 注册。
// 主修饰键 macOS 是 ⌘、Windows / Linux 是 Ctrl；重做在 Windows / Linux 上还可以用 Ctrl+Y。
export function useTimelineShortcuts({ blocked, restoreEdit, copy, paste, remove, selectAll, clearSelection }: {
  blocked: boolean; restoreEdit: (direction: 'undo' | 'redo') => void;
  copy: () => void; paste: () => void; remove: (ripple?: boolean) => void;
  selectAll: () => void; clearSelection: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (blocked || event.defaultPrevented || composing(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (typingTarget(target) || target?.closest('[role="menu"]') || dialogOpen()) return;
      const history = historyAction(event, platform);
      if (history) { event.preventDefault(); restoreEdit(history); return; }
      if (!target?.closest('.multitrack')) return;
      const pressed = eventBindings(event, platform)[0]?.binding;
      if (pressed === 'mod+C') { event.preventDefault(); copy(); }
      else if (pressed === 'mod+V') { event.preventDefault(); paste(); }
      else if (pressed === 'mod+A') { event.preventDefault(); selectAll(); }
      else if (pressed === 'delete' || pressed === 'backspace' || pressed === 'shift+delete' || pressed === 'shift+backspace') { event.preventDefault(); remove(event.shiftKey); }
      else if (pressed === 'esc') { clearSelection(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
