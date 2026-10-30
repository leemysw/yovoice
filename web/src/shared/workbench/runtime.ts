// 推理内核（audio.cpp）的版本判断：是否安装、是否低于最低/推荐版本，以及模型对内核版本的额外要求。
import type { ModelPackage, State } from './types';

// version 是推荐安装的 audio.cpp 版本，minimum 是当前应用可用的最低版本。
export interface EngineInfo { version: string; minimum: string }
// 服务未报告版本要求（如浏览器预览）时不做限制。
export const versionAtLeast = (value: string | null, minimum: string) => {
  if (!minimum) return true;
  const parse = (v: string | null) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '')?.slice(1).map(Number);
  const a = parse(value), b = parse(minimum);
  if (!a || !b) return false;
  const index = a.findIndex((n, i) => n !== b[i]);
  return index < 0 || a[index] > b[index];
};
// 内核需与所选设备一致：低于最低版本时必须更新；不低于最低版本但低于推荐版本时可继续使用，升级可选。
export type RuntimeStatus = 'ready' | 'upgradable' | 'outdated' | 'missing';
export const runtimeStatus = (state: State, engine: EngineInfo): RuntimeStatus =>
  !state.runtimePath || state.runtimeBackend !== state.preferences.backend ? 'missing'
    : !versionAtLeast(state.runtimeVersion, engine.minimum) ? 'outdated'
      : versionAtLeast(state.runtimeVersion, engine.version) ? 'ready' : 'upgradable';
export const runtimeUsable = (status: RuntimeStatus) => status === 'ready' || status === 'upgradable';
// 部分模型（如音乐）需要比应用最低版本更新的内核。
export const modelEngineReady = (state: State, model?: ModelPackage) => !model?.engineMinimum || versionAtLeast(state.runtimeVersion, model.engineMinimum);
