import { CallError } from './call-error';

// 上传给本地服务或预览后端的音频上限；更大的文件先在界面里拒绝，不占用消息通道。
export const maxUploadBytes = 20 * 1024 * 1024;

export function assertUploadSize(file: Blob) {
  if (file.size > maxUploadBytes) throw new CallError('@yovoice.error.audioTooLarge');
}
