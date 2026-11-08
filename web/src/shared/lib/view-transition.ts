import { flushSync } from 'react-dom';

// 界面结构变化（换页、侧栏或右侧面板收起展开、打开作品）用视图过渡衔接：浏览器先拍下旧画面，
// 同步提交新状态后再在两帧之间按 app/motion.css 里命名的区域做形变，让注意力跟着元素走，而不是整页闪一下。
// kind 写在 <html data-transition> 上，样式据此为不同的变化选择动效；过渡结束后移除。
// 不支持视图过渡的 WebView、减少动态效果或页面在后台时直接更新，界面结果完全一致。
export type TransitionKind = 'page' | 'sidebar' | 'inspector' | 'open-project' | 'notice';

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

// 正在执行某次过渡的更新时，里面再发起的过渡（如打开作品时顺带换页）并入当前这次，不另起一次打断它。
let updating = false;

export function withViewTransition(update: () => void, kind: TransitionKind) {
  const doc = document as TransitionDocument;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (updating || !doc.startViewTransition || reduced || document.hidden) { update(); clearSources(); return; }
  const root = document.documentElement;
  root.dataset.transition = kind;
  const done = () => { if (root.dataset.transition === kind) delete root.dataset.transition; clearSources(); };
  try {
    doc.startViewTransition(() => {
      updating = true;
      try { flushSync(update); } finally { updating = false; }
    }).finished.then(done, done);
  } catch {
    done();
    update();
  }
}

// 过渡的来源元素（如作品列表里被点开的那张卡片标题）用 data-vt-source 标记，在新画面里形变成对应的目标
// （作品标题）；过渡结束后清掉。打开失败没有发生过渡时也在稍后清掉，免得混进下一次换页。
export function markTransitionSource(element: Element) {
  clearSources();
  element.setAttribute('data-vt-source', '');
  window.setTimeout(clearSources, 3000);
}

export const hasTransitionSource = () => !!document.querySelector('[data-vt-source]');

function clearSources() {
  document.querySelectorAll('[data-vt-source]').forEach(element => element.removeAttribute('data-vt-source'));
}
