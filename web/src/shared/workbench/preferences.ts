// 偏好设置相关的判断：功能入口是否隐藏、AI 服务是否可供助手使用、AI 写作的默认超时。
import type { AIProvider, Feature, Preferences, TranscribeSettings } from './types';

export const featureHidden = (preferences: Preferences, feature: Feature) => !!preferences.hiddenFeatures?.includes(feature);
// AI 服务主要供 Ocho 与音乐创作使用，两者都隐藏时 AI 服务设置与有声书的 AI 分配角色一并隐藏。
export const aiServiceHidden = (preferences: Preferences) => featureHidden(preferences, 'assistant') && featureHidden(preferences, 'music');

export const aiTimeoutDefault = 600;
// ChatGPT 订阅经 Codex CLI 调用，没有接口地址与密钥，Ocho 用不了；助手只认接口类服务。
export const codexProvider = (p?: AIProvider) => p?.format === 'codex_cli';
export const assistantUsable = (p?: AIProvider) => !!p?.model && !codexProvider(p);

// 语音转写的默认值与允许范围，与服务端 schema.TranscribeSettings 一致。
export const transcribeDefaults: Required<TranscribeSettings> = { maxFileMB: 4096, maxMinutes: 60, lineChars: 20, lineSeconds: 6, linePause: .8 };
export const transcribeRanges: Record<keyof TranscribeSettings, [number, number]> = { maxFileMB: [20, 16384], maxMinutes: [1, 180], lineChars: [6, 80], lineSeconds: [1, 20], linePause: [.2, 5] };
export const transcribeSettings = (preferences: Preferences): Required<TranscribeSettings> => ({ ...transcribeDefaults, ...preferences.transcribe });
