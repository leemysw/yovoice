import { useEffect, type RefObject } from 'react';

const modalSelector = 'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]';
// 打开着的菜单、下拉列表自己管焦点（打开、关闭的过程中焦点可能短暂落在 body）。
const layerSelector = '[role="menu"], [role="listbox"]';
const visible = (element: Element) => element.getClientRects().length > 0;

/**
 * 全屏弹窗（播放页、分轨工作台）的快捷键限定在根元素里（within）。聚焦的按钮被移除（校准条收起、菜单的触发按钮消失）、
 * 盖在上面的速查浮层或确认框卸载时没有归还焦点，或菜单用鼠标关上后主动失焦，焦点都会落到 body，快捷键就不再响应；
 * 这时把焦点放回根元素。上面另有对话框、菜单打开时不动焦点。根元素需要 tabIndex={-1}。
 */
export function useFocusHome(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const own = element.closest('dialog');
    let frame = 0;
    const check = () => {
      const active = document.activeElement;
      if ((active && active !== document.body) || !element.isConnected) return;
      const covered = Array.from(document.querySelectorAll(modalSelector)).some(dialog => dialog !== own && visible(dialog))
        || Array.from(document.querySelectorAll(layerSelector)).some(visible);
      if (!covered) element.focus({ preventScroll: true });
    };
    // 当下就检查一次（紧接着的按键也能用），下一帧再看一次：菜单、对话框关闭后稍晚的焦点归还做完，焦点仍落在 body 时再放回。
    const schedule = () => { check(); if (!frame) frame = requestAnimationFrame(() => { frame = 0; check(); }); };
    // 移除聚焦元素时不一定有 focusout（各浏览器不一致）；别处的对话框卸载也会丢焦点，页面结构变化时都检查。
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // 失焦事件分发时焦点还在变化中，放到微任务里再看。
    const blurred = () => queueMicrotask(schedule);
    element.addEventListener('focusout', blurred);
    return () => { observer.disconnect(); element.removeEventListener('focusout', blurred); cancelAnimationFrame(frame); };
  }, [root]);
}
