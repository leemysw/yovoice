// 本机界面偏好（当前页面、面板开合、歌词样式等）的读写。存储不可用（被禁用、配额已满）时读到 null、写入忽略，
// 偏好只在本次生效，不影响使用。所有界面偏好都经这里读写，不直接调用 localStorage。
export function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* 只在本次生效 */ }
}

export function removeLocal(key: string) {
  try { localStorage.removeItem(key); } catch { /* 存储不可用时无需清理 */ }
}
