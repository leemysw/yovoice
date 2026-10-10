import type { Page } from '@playwright/test';
import type { State } from '../src/shared/workbench';

// 在下一次加载前写入工作台状态：直接改 localStorage 再刷新时，当前页面待执行的自动保存可能抢先覆盖它。
export async function seedState(page: Page, state: State) {
  const key = `yovoice-test-seed-${Math.random()}`;
  await page.addInitScript(([key, value]) => {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1'); localStorage.setItem('voice-workbench-v1', value);
  }, [key, JSON.stringify(state)] as const);
}
