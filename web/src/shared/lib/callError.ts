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
