import type { MessageCode, MessageParams } from '../workbench';

/** Structured /api/call failure. Wire: { code, params? }. */
export class CallError extends Error {
  readonly code: MessageCode;
  readonly params: MessageParams;

  constructor(code: MessageCode, params: MessageParams = {}) {
    super(code);
    this.name = 'CallError';
    this.code = code;
    this.params = params;
  }
}

export function parseCallError(wire: unknown): CallError {
  if (wire && typeof wire === 'object' && 'code' in wire) {
    const code = String((wire as { code: unknown }).code);
    if (code.startsWith('@yovoice.')) {
      const params = (wire as { params?: MessageParams }).params ?? {};
      return new CallError(code as MessageCode, params);
    }
  }
  if (typeof wire === 'string' && wire.startsWith('@yovoice.')) {
    return new CallError(wire as MessageCode);
  }
  const detail = typeof wire === 'string' ? wire : wire != null ? JSON.stringify(wire) : '';
  return new CallError('@yovoice.error.unknown', detail ? { detail } : {});
}

/** 存入界面状态的错误文本：保留结构化参数，渲染时按当前语言翻译。 */
export function noticeMessage(error: unknown): string {
  if (error instanceof CallError && Object.keys(error.params).length) {
    if (error.code === '@yovoice.error.unknown') return error.params.detail ? `${error.code}::${String(error.params.detail)}` : error.code;
    return `${error.code}::${JSON.stringify(error.params)}`;
  }
  return error instanceof Error ? error.message : String(error);
}
