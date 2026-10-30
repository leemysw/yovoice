import { createDraft, newId, blocksText, type State, type Draft, type AssistantLive, type AssistantSession, type AssistantBlock, type AssistantToolCardState, type AssistantContext } from '../../workbench';
import { CallError } from '../call-error';
import { publish } from './store';

// 预览助手的轮次序号，用于让停止后的旧定时器失效；运行中再发的消息与真实后端一样排队。
let assistantTurnSeq = 0;
let assistantQueue: unknown[] = [];

// 预览的助手会话：与真实后端一致，当前会话由 currentId 指向，消息写入当前会话。
function currentSession(state: State): AssistantSession | undefined {
  return state.assistantSessions?.sessions.find(session => session.id === state.assistantSessions?.currentId);
}

function touchSession(state: State): AssistantSession {
  const sessions = state.assistantSessions ?? { currentId: '', sessions: [] };
  state.assistantSessions = sessions;
  let session = currentSession(state);
  if (!session) {
    session = { id: newId(), title: '', messages: [], updatedAt: new Date().toISOString() };
    sessions.sessions.unshift(session);
    sessions.currentId = session.id;
  }
  return session;
}

// 预览模拟助手对话：流式文本、工具卡片与界面事件都按真实路径写进状态，编辑器内容与页面随之变化。
// available 是助手运行时是否可用；本轮结束后若队列里还有消息，经 resend 交回 RPC 入口重新发送。
export function assistantSend(state: State, data: unknown, available: boolean, resend: (data: unknown) => void): boolean {
  const input = data as { text: string; context?: AssistantContext };
  Object.assign(window, { __assistantContext: input.context });
  const provider = state.aiProviders?.find(p => p.id === state.aiProviderID);
  if (!available) throw new CallError('@yovoice.error.assistantMissing');
  if (!provider?.model) throw new CallError('@yovoice.error.aiNotConfigured');
  if (state.assistantLive?.turn) {
    assistantQueue.push(data);
    state.assistantLive.queued = assistantQueue.length;
    publish();
    return true;
  }
  const chat = touchSession(state);
  chat.messages.push({ id: newId(), role: 'user', text: input.text, createdAt: new Date().toISOString() });
  if (!chat.title) chat.title = input.text.split('\n')[0].slice(0, 24);
  chat.updatedAt = new Date().toISOString();
  const blocks: AssistantBlock[] = [];
  const live: AssistantLive = state.assistantLive ?? {};
  state.assistantLive = live;
  // 每轮一个序号：停止或新一轮开始后，旧一轮尚未触发的定时器全部失效，不会写进下一轮。
  const seq = ++assistantTurnSeq;
  const alive = () => Boolean(live.turn) && seq === assistantTurnSeq;
  const commit = () => { if (live.turn) { live.turn = { ...live.turn, blocks: blocks.map(block => ({ ...block, card: block.card ? { ...block.card } : undefined })) }; publish(); } };
  // 模拟逐字流式：把一段文字拆成小块，与上一块同类时接上，否则开新的一块。
  const stream = (at: number, kind: 'text' | 'thinking', text: string) => {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      setTimeout(() => {
        if (!alive()) return;
        const last = blocks[blocks.length - 1];
        if (last?.kind === kind) last.text = (last.text ?? '') + chunk; else blocks.push({ kind, text: chunk });
        commit();
      }, at + i * 12);
    }
  };
  const card = (at: number, tool: string, summary: string, cardState: AssistantToolCardState) => setTimeout(() => {
    if (!alive()) return;
    const existing = blocks.find(block => block.card?.tool === tool && block.card.state === 'running');
    if (existing?.card) Object.assign(existing.card, { summary, state: cardState }); else blocks.push({ kind: 'tool', card: { tool, summary, state: cardState } });
    commit();
  }, at);
  const timer = (at: number, run: () => void) => setTimeout(() => { if (alive()) run(); }, at);
  live.turn = { blocks: [], model: provider.model, startedAt: new Date().toISOString() };
  publish();
  const wantsDelete = /删除|删掉|delete/i.test(input.text);
  const wantsRemember = /记住|remember/i.test(input.text);
  if (wantsDelete || wantsRemember) {
    // 删除走确认卡片，偏好直接记下；两者都只模拟真实后端的结果形态。
    const target = state.drafts.find(d => input.text.includes(d.title)) ?? state.drafts[0];
    if (wantsDelete && target) {
      timer(500, () => {
        blocks.push({ kind: 'tool', card: { tool: 'propose_action', summary: `删除作品《${target.title}》`, state: 'done', proposal: { id: newId(), action: 'delete_work', target: target.id, label: target.title, reason: '这是一份重复的草稿。', state: 'pending' } } });
        commit();
      });
    }
    if (wantsRemember) {
      const text = input.text.replace(/^.*?(记住|remember)[:：，,\s]*/i, '').trim() || input.text;
      timer(500, () => {
        state.assistantMemory = [...(state.assistantMemory ?? []).filter(memo => memo.text !== text), { id: newId(), text, createdAt: new Date().toISOString() }];
        blocks.push({ kind: 'tool', card: { tool: 'remember_preference', summary: `记住了：${text}`, state: 'done' } });
        commit();
      });
    }
    stream(900, 'text', wantsDelete ? '我放了一张确认卡片，确认后就删除。' : '记下了，以后都按这个来。');
    setTimeout(() => {
      if (!alive()) return;
      chat.messages.push({ id: newId(), role: 'assistant', text: blocksText(blocks), blocks: live.turn?.blocks ?? [], status: 'completed', createdAt: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString();
      live.turn = undefined;
      publish();
    }, 1600);
    return true;
  }
  const wantsScore = /钢琴|旋律|编曲|配乐|score|piano/i.test(input.text);
  const wantsSong = /写词|写歌|歌词|歌|lyric|song/i.test(input.text);
  let draftID = '';
  stream(100, 'thinking', wantsScore ? '用户要一段钢琴旋律，先新建编曲作品，再写四小节。' : '先看看现在有哪些作品。');
  if (wantsScore || wantsSong) {
    card(600, 'create_work', wantsScore ? '新建了《示例小步舞曲》' : '新建了《夏夜兜风》', 'running');
    timer(700, () => {
      draftID = newId();
      const draft: Draft = wantsScore
        ? { ...createDraft(false, state.preferences.uiLocale, 'musescore-general-sf2'), id: draftID, kind: 'score', title: '示例小步舞曲', score: { tempo: 100, timeSignature: [4, 4], sections: [], tracks: [] } }
        : { ...createDraft(false, state.preferences.uiLocale, 'ace-step-1.5-turbo-bf16'), id: draftID, kind: 'music', title: '夏夜兜风', text: 'city pop, warm synths', lyrics: '[verse]\n晚风吹过海岸线\n[chorus]\n夏夜一路向前' };
      state.drafts = [draft, ...state.drafts];
      live.update = { id: newId(), workId: draftID };
      live.nav = { id: newId(), workId: draftID };
      publish();
    });
    card(800, 'create_work', wantsScore ? '新建了《示例小步舞曲》' : '新建了《夏夜兜风》', 'done');
    if (wantsScore) {
      card(1100, 'update_work', '正在修改《示例小步舞曲》的乐谱…', 'running');
      timer(1600, () => {
        const target = state.drafts.find(d => d.id === draftID);
        if (!target?.score) return;
        target.score = { tempo: 100, timeSignature: [4, 4], sections: [{ name: 'A', start: 1, end: 4 }], tracks: [{ id: 'p', name: '钢琴', role: 'piano', program: 0, notes: [{ bar: 1, beat: 1, pitch: 60, length: 1, velocity: 80 }, { bar: 1, beat: 3, pitch: 64, length: 1, velocity: 76 }, { bar: 2, beat: 1, pitch: 67, length: 2, velocity: 78 }] }] };
        live.update = { id: newId(), workId: draftID };
        publish();
      });
      card(1900, 'update_work', '修改了《示例小步舞曲》的乐谱', 'done');
    }
  } else {
    card(600, 'list_works', `查看了作品列表（${state.drafts.length} 个）`, 'done');
  }
  stream(2200, 'text', wantsScore ? '写好了：四小节钢琴旋律已经写进《示例小步舞曲》，可以直接**渲染**试听。' : '好的，我先看了作品列表。想让我做什么？');
  setTimeout(() => {
    if (!alive()) return;
    chat.messages.push({ id: newId(), role: 'assistant', text: blocksText(blocks), blocks: live.turn?.blocks ?? [], status: 'completed', createdAt: new Date().toISOString() });
    chat.updatedAt = new Date().toISOString();
    live.turn = undefined;
    const next = assistantQueue.shift();
    live.queued = assistantQueue.length;
    publish();
    if (next) resend(next);
  }, 3200);
  return true;
}

// 停止当前轮：清空队列、让本轮定时器失效，并把已产出的块作为“已取消”的助手消息落到会话里。
export function assistantCancel(state: State): boolean {
  const live = state.assistantLive;
  assistantQueue = [];
  if (live?.turn) {
    assistantTurnSeq++;
    const chat = currentSession(state);
    chat?.messages.push({ id: newId(), role: 'assistant', text: blocksText(live.turn.blocks ?? []), blocks: live.turn.blocks ?? [], status: 'cancelled', createdAt: new Date().toISOString() });
    live.turn = undefined;
    live.queued = 0;
    publish();
  }
  return true;
}

export function assistantNew(state: State): AssistantSession {
  const sessions = state.assistantSessions ?? { currentId: '', sessions: [] };
  const session: AssistantSession = { id: newId(), title: '', messages: [], updatedAt: new Date().toISOString() };
  sessions.sessions = [session, ...sessions.sessions];
  sessions.currentId = session.id;
  state.assistantSessions = sessions;
  if (state.assistantLive?.turn) { state.assistantLive.turn = undefined; state.assistantLive.queued = 0; }
  publish();
  return structuredClone(session);
}

export function assistantOpen(state: State, data: unknown): boolean {
  const id = (data as { id: string }).id;
  if (!state.assistantSessions?.sessions.some(session => session.id === id)) throw new CallError('@yovoice.error.requestInvalid');
  state.assistantSessions.currentId = id;
  publish();
  return true;
}

// 确认或忽略提案卡片：同一提案可能出现在多条消息里，统一改状态；确认删除作品时真的删掉。
export function assistantProposal(state: State, data: unknown): boolean {
  const { id, confirm } = data as { id: string; confirm: boolean };
  const cards = (state.assistantSessions?.sessions ?? []).flatMap(session => session.messages.flatMap(message => message.blocks ?? [])).map(block => block.card).filter(card => card?.proposal?.id === id);
  const proposal = cards[0]?.proposal;
  if (!proposal || proposal.state !== 'pending') throw new CallError('@yovoice.error.requestInvalid');
  if (confirm && proposal.action === 'delete_work') state.drafts = state.drafts.filter(d => d.id !== proposal.target);
  for (const card of cards) card!.proposal = { ...proposal, state: confirm ? 'confirmed' : 'dismissed' };
  publish();
  return true;
}

export function assistantForget(state: State, data: unknown): boolean {
  const id = (data as { id?: string }).id;
  state.assistantMemory = id ? (state.assistantMemory ?? []).filter(memo => memo.id !== id) : [];
  publish();
  return true;
}

export function assistantDelete(state: State, data: unknown): boolean {
  const id = (data as { id: string }).id;
  const sessions = (state.assistantSessions?.sessions ?? []).filter(session => session.id !== id);
  const currentId = state.assistantSessions?.currentId === id ? sessions[0]?.id ?? '' : state.assistantSessions?.currentId ?? '';
  state.assistantSessions = { currentId, sessions };
  publish();
  return true;
}
