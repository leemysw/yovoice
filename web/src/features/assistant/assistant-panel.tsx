import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ChatComposer, ChatMessage, ChatMessageBubble, ChatMessageList, ChatSendButton } from '@astryxdesign/core/Chat';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ChevronDown, ChevronLeft, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, SquarePen, TextQuote, Trash2, X } from 'lucide-react';
import { call, mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import { assistantUsable, codexProvider, type AssistantBlock, type AssistantContext, type State, type Generation } from '../../shared/workbench';
import { messageBlocks, turnCards } from './assistant-model';
import { AssistantTurn } from './assistant-turn';
import type { usePanelFrame } from './assistant-frame';
import { AssistantAvatar } from './assistant-avatar';
import { clearAssistantSelection, takeAssistantFocus, useAssistantSelection } from './assistant-focus';
import { Selector } from '../../shared/selector';
import voiceArt from '../../assets/assistant/empty-voice.webp';
import musicArt from '../../assets/assistant/empty-music.webp';
import storyArt from '../../assets/assistant/empty-story.webp';
import { useAssistantLive } from '../../shared/lib/assistant-live';

// 助手面板：浮在工作区上的对话卡片，拖标题栏移动、拖左上边角缩放；放大只拉长到窗口高度、宽度不变，向下箭头收起成入口。
// 对话按会话组织（标题处切换历史），发送、停止、新建、删除经 assistant.* RPC；运行中的一轮按内容块实时渲染。
// 这些调用失败时在面板内提示，不弹全局通知，也不丢掉正在输入的内容。

// 一条消息最多的字数，与服务端一致。
const messageLimit = 2000;

interface ActivePlayback { element: HTMLAudioElement; id: string; url: string }

// 停下正在试听的回复音频并释放它的地址：暂停、切换到别的结果、卸载都走这里。
function stopPlayback(ref: RefObject<ActivePlayback | null>) {
  const active = ref.current;
  ref.current = null;
  if (!active) return;
  active.element.pause();
  releaseMediaUrl(active.url);
}

/** 助手要求打开某作品时由应用层执行（面板自己不掌握页面状态）。 */
export interface AssistantPanelActions {
  openWork: (workId: string) => void;
  openSettings: () => void;
}

export interface QuickAction {
  label: string;
  prompt: string;
}

export function AssistantPanel({ state, context, expanded, quickActions, frame, style, onToggleExpand, onClose, actions }: {
  state: State; context: AssistantContext; expanded: boolean; quickActions: QuickAction[];
  frame: ReturnType<typeof usePanelFrame>; style?: CSSProperties;
  onToggleExpand: () => void; onClose: () => void; actions: AssistantPanelActions;
}) {
  const t = useTranslator();
  const live = useAssistantLive();
  const running = !!live?.turn;
  const sessions = state.assistantSessions?.sessions ?? [];
  const current = sessions.find(session => session.id === state.assistantSessions?.currentId);
  const messages = current?.messages ?? [];
  const provider = state.aiProviders?.find(p => p.id === state.aiProviderID);
  // 当前服务是 ChatGPT 订阅时提前说明，不等发送后才报错。
  const codex = codexProvider(provider);
  const configured = assistantUsable(provider);
  const runtimeMissing = !!state.assistantMissing;
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // 面板内的错误提示：发送、会话操作、切换模型或试听失败时显示在输入区上方。
  const [error, setError] = useState('');
  const fail = (e: unknown) => setError(formatCallError(t, e));
  const audioRef = useRef<ActivePlayback | null>(null);
  // 试听请求的序号：快速连点时只有最后一次会播放，卸载后回来的结果直接丢弃。
  const playToken = useRef(0);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { playToken.current++; stopPlayback(audioRef); }, []);
  useEffect(() => { if (running) setHistoryOpen(false); }, [running]);

  // 输入框在提交时就会清空：超长、会话忙等发送失败时把内容放回去（用户没有另起新内容的话），错误显示在面板内；
  // typed 为真表示来自输入框，空状态的快捷建议失败只提示。
  const send = (text: string, typed = false) => {
    const trimmed = text.trim();
    if (!trimmed || !configured || runtimeMissing) return;
    setHistoryOpen(false);
    setError('');
    // 选中的文字与播放位置在发送这一刻取出：选区只随这一条消息带上。
    void call('assistant.send', { text: trimmed, context: { ...context, ...takeAssistantFocus() } })
      .catch((e: unknown) => { fail(e); if (typed) setDraft(current => current.trim() ? current : text); });
  };
  const selection = useAssistantSelection();
  const resolveProposal = (id: string, confirm: boolean) => call('assistant.proposal', { id, confirm }).then(() => undefined);
  const newSession = () => {
    if (running) return;
    setHistoryOpen(false);
    void call('assistant.new').catch(fail);
  };
  const openSession = (id: string) => {
    setHistoryOpen(false);
    setDeleting(null);
    void call('assistant.open', { id }).catch(fail);
  };
  const deleteSession = (id: string) => {
    setDeleting(null);
    void call('assistant.delete', { id }).catch(fail);
  };
  const cancel = () => { void call('assistant.cancel').catch(fail); };

  // 试听回复里的生成结果：再点一次暂停；取地址期间又点了别的或面板已卸载时不再播放，失败时清掉引用并提示。
  const play = async (item: Generation) => {
    const token = ++playToken.current;
    const same = audioRef.current?.id === item.id;
    stopPlayback(audioRef);
    setPlaying(null);
    if (same) return;
    let url: string;
    try { url = await mediaUrl('outputs', item.fileName); }
    catch (e) { if (token === playToken.current) fail(e); return; }
    if (token !== playToken.current) { releaseMediaUrl(url); return; }
    const element = new Audio(url);
    audioRef.current = { element, id: item.id, url };
    setPlaying(item.id);
    element.onended = () => { if (audioRef.current?.element === element) { stopPlayback(audioRef); setPlaying(null); } };
    try { await element.play(); }
    catch (e) {
      if (audioRef.current?.element !== element) return;
      stopPlayback(audioRef);
      setPlaying(null);
      if ((e as DOMException).name !== 'AbortError') setError(t('@yovoice.error.audioPlayFailed'));
    }
  };

  // 当前作品总是随消息带上；输入框左下角用来切换 AI 服务里的模型，与设置页共用同一份当前模型。
  const choice = (id: string, model: string) => `${id}\n${model}`;
  const modelOptions = (state.aiProviders ?? []).filter(p => p.model || p.models?.length)
    .map(p => ({ type: 'section' as const, title: p.name, options: [...new Set([p.model, ...(p.models ?? [])].filter(Boolean))].map(model => ({ value: choice(p.id, model), label: model })) }));
  const pickModel = (value: string) => { const [id, model] = value.split('\n'); void call('ai.provider.use', { id, model }).catch(fail); };
  // 写作与助手共用当前服务，这里也是切换服务的入口，ChatGPT 订阅照样列出；选中它时面板给出说明并保留选择，方便切回。
  const modelPicker = provider ? <Selector label={t('@yovoice.ai.model')} isLabelHidden size="sm" variant="ghost" className="assistant-model" data-testid="assistant-model"
    value={provider.model ? choice(provider.id, provider.model) : undefined} options={modelOptions} onChange={pickModel}
    hasSearch={modelOptions.reduce((n, section) => n + section.options.length, 0) > 12} searchPlaceholder={t('@yovoice.ai.searchModels')} /> : undefined;
  const empty = messages.length === 0 && !running;
  const title = current?.title || t('@yovoice.assistant.title');
  const banner = emptyArt[context.workKind || context.page || ''] ?? emptyArt.text;

  // 内容区自己滚动；新内容到来时，只有本来就停在底部才跟随到底，用户往上翻看时不打扰。
  const bodyRef = useRef<HTMLElement | null>(null);
  const pinned = useRef(true);
  const liveBlocks = live?.turn?.blocks;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && pinned.current) body.scrollTop = body.scrollHeight;
  }, [messages.length, liveBlocks, current?.id, empty]);
  const onScroll = () => {
    const body = bodyRef.current;
    if (body) pinned.current = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  };

  return <VStack className={`assistant-panel${expanded ? ' expanded' : ''}`} gap={0} style={style} data-moving={frame.moving || undefined} data-testid="assistant-panel" data-open="true" role="complementary" aria-label={t('@yovoice.assistant.title')}>
    <StackItem as="span" className="assistant-resize" data-edge="left" aria-hidden onPointerDown={frame.begin('left')} />
    {expanded ? null : <>
      <StackItem as="span" className="assistant-resize" data-edge="top" aria-hidden onPointerDown={frame.begin('top')} />
      <StackItem as="span" className="assistant-resize" data-edge="top-left" aria-hidden onPointerDown={frame.begin('top-left')} />
    </>}
    <HStack className="assistant-header" vAlign="center" gap={1}
      onPointerDown={frame.begin('move')}
      onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) onToggleExpand(); }}>
      {/* 历史会话是从左侧滑出的抽屉，用侧栏图标与右侧的线性图标保持一致。 */}
      <Button data-testid="assistant-history-toggle" size="sm" variant="ghost" isIconOnly icon={historyOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />} label={t('@yovoice.assistant.history')}
        aria-expanded={historyOpen} onClick={() => { setHistoryOpen(open => !open); setDeleting(null); }} />
      <AssistantAvatar working={running} size={24} />
      {/* Text 的属性类型不含 title，拖动提示用展开写法原样传给 DOM。 */}
      <Text type="inherit" color="inherit" className="assistant-title grow" {...{ title: t('@yovoice.assistant.move') }}>{title}</Text>
      {live?.queued ? <small className="assistant-queued">{t('@yovoice.assistant.queued', { count: live.queued })}</small> : null}
      <Button size="sm" variant="ghost" isIconOnly icon={<SquarePen size={15} />} label={t('@yovoice.assistant.newChat')} isDisabled={running} onClick={newSession} />
      <Button size="sm" variant="ghost" isIconOnly icon={expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />} label={expanded ? t('@yovoice.assistant.collapse') : t('@yovoice.assistant.expand')} onClick={onToggleExpand} />
      <Button data-testid="assistant-minimize" size="sm" variant="ghost" isIconOnly icon={<ChevronDown size={16} />} label={t('@yovoice.assistant.close')} onClick={onClose} />
    </HStack>
    <VStack className="assistant-body" gap={0} ref={bodyRef} onScroll={onScroll}>
      {empty ? <VStack gap={3} className="assistant-empty" hAlign="center">
        <img className="assistant-empty-art" src={banner} alt="" draggable={false} />
        <p className="assistant-empty-title">{t('@yovoice.assistant.empty')}</p>
        <p className="assistant-empty-hint">{t('@yovoice.assistant.emptyHint')}</p>
        {/* 建议跟着空白引导一起出现，发出第一句后随引导一起消失，不单独占一条，也就不会因收起而让布局跳动。 */}
        {quickActions.length ? <HStack className="assistant-suggestions" gap={2} hAlign="center" wrap="wrap">
          {quickActions.map(action => <Button key={action.label} size="sm" variant="secondary" className="assistant-suggestion" label={action.label}
            onClick={() => send(action.prompt)} />)}
        </HStack> : null}
      </VStack> : <ChatMessageList density="compact" gap={4} align="top" isStreaming={running}>
        {messages.map(message => message.role === 'user'
          ? <ChatMessage key={message.id} sender="user"><ChatMessageBubble>{message.text}</ChatMessageBubble></ChatMessage>
          : <ChatMessage key={message.id} sender="assistant">
            <AssistantTurn blocks={messageBlocks(message)} live={false} message={message} generation={generationCard(messageBlocks(message), state)} playing={playing} onPlay={play} openWork={actions.openWork} onResolve={resolveProposal} />
          </ChatMessage>)}
        {live?.turn ? <ChatMessage key="live" sender="assistant">
          <AssistantTurn blocks={live.turn.blocks ?? []} live generation={null} playing={null} onPlay={() => undefined} openWork={() => undefined} onResolve={resolveProposal} />
        </ChatMessage> : null}
      </ChatMessageList>}
    </VStack>
    {error ? <HStack className="assistant-notice" role="alert" data-tone="danger" data-testid="assistant-error" gap={2} vAlign="center">
      <Text type="inherit" color="inherit" className="grow">{error}</Text>
      <Button size="sm" variant="ghost" isIconOnly icon={<X size={14} />} label={t('@yovoice.action.closeNotice')} onClick={() => setError('')} />
    </HStack> : null}
    {runtimeMissing ? <HStack className="assistant-notice" role="alert" gap={2} vAlign="center">
      <Text type="inherit" color="inherit" className="grow">{t('@yovoice.ai.assistantMissing')}</Text>
    </HStack> : codex ? <VStack className="assistant-notice" gap={2} data-testid="assistant-codex">
      <Text type="inherit" color="inherit">{t('@yovoice.error.assistantProvider')}</Text>
      {modelPicker}
    </VStack> : !configured ? <HStack className="assistant-notice" gap={2} vAlign="center">
      <Text type="inherit" color="inherit" className="grow">{t('@yovoice.assistant.setup')}</Text>
      <Button size="sm" variant="secondary" label={t('@yovoice.ai.configure')} onClick={actions.openSettings} />
    </HStack> : <VStack className="assistant-dock-bottom" gap={0}>
      {/* 输入框是可编辑区域而不是 textarea，字数上限在这里截断，与服务端的限制一致。 */}
      <ChatComposer className="assistant-composer" density="compact" value={draft} onChange={value => setDraft(value.length > messageLimit ? value.slice(0, messageLimit) : value)}
        placeholder={t('@yovoice.assistant.placeholder')} isDisabled={runtimeMissing}
        isStopShown={running} onStop={cancel}
        onSubmit={value => send(value, true)} sendButton={<ChatSendButton className="assistant-send" />}
        // 编辑区里选中的文字会随下一条消息带给 Ocho：以引用标签放在输入框里，点 × 不带。
        headerActions={selection ? <Token data-testid="assistant-selection" className="assistant-selection" size="sm" icon={<TextQuote size={12} />}
          label={selection.replace(/\s+/g, ' ')} description={t('@yovoice.assistant.selectionHint')} onRemove={clearAssistantSelection} /> : undefined}
        footerActions={modelPicker} />
    </VStack>}
    {/* 历史是从左侧滑出的抽屉，右边留一条遮罩露出当前对话，点遮罩或返回即收起。 */}
    {historyOpen ? <>
      <StackItem as="span" className="assistant-scrim" aria-hidden onClick={() => setHistoryOpen(false)} />
      <VStack className="assistant-history" gap={0} data-testid="assistant-history" role="dialog" aria-label={t('@yovoice.assistant.history')}>
        {/* 抽屉头：左侧返回，右侧新对话；列表每行一条会话，标题单行截断，条数和时间在下一行，删除按钮悬停时出现。 */}
        <HStack className="assistant-history-header" vAlign="center" gap={1}>
          <Button size="sm" variant="ghost" isIconOnly icon={<ChevronLeft size={16} />} label={t('@yovoice.assistant.back')} onClick={() => setHistoryOpen(false)} />
          <Text type="inherit" color="inherit" className="assistant-title grow">{t('@yovoice.assistant.history')}</Text>
          <Button size="sm" variant="ghost" isIconOnly icon={<SquarePen size={15} />} label={t('@yovoice.assistant.newChat')} tooltip={t('@yovoice.assistant.newChat')} isDisabled={running} onClick={newSession} />
        </HStack>
        <VStack className="assistant-history-list" gap={0}>
          {sessions.length === 0 ? <small className="assistant-history-empty">{t('@yovoice.assistant.historyEmpty')}</small> : <List density="compact">
            {sessions.map(session => <ListItem key={session.id} className="assistant-history-item" isSelected={session.id === current?.id}
              label={session.title || t('@yovoice.assistant.newChat')}
              description={`${t('@yovoice.assistant.messageCount', { count: session.messages.length })} · ${relativeTime(t, session.updatedAt)}`}
              onClick={() => openSession(session.id)}
              endContent={deleting === session.id
                ? <Button size="sm" variant="destructive" label={t('@yovoice.assistant.deleteConfirm')} onClick={() => deleteSession(session.id)} />
                : <Button size="sm" variant="ghost" isIconOnly className="assistant-history-delete" icon={<Trash2 size={14} />} label={t('@yovoice.assistant.deleteChat', { title: session.title || t('@yovoice.assistant.newChat') })} onClick={() => setDeleting(session.id)} />} />)}
          </List>}
        </VStack>
      </VStack>
    </> : null}
  </VStack>;
}

// 空状态插图：按当前页面换一张（台词/语音、音乐/编曲、故事配音）。
const emptyArt: Record<string, string> = { text: voiceArt, voices: voiceArt, music: musicArt, score: musicArt, sfx: musicArt, story: storyArt };

// generationCard 找到 generate_work 已完成且该作品已有版本的结果，供试听。
function generationCard(blocks: AssistantBlock[], state: State): Generation | null {
  const cards = turnCards(blocks).filter(card => card.tool === 'generate_work');
  if (!cards.some(card => card.state === 'done')) return null;
  const workID = cards.map(card => workIDFromArgs(card.args)).find(Boolean);
  return workID ? state.history.find(item => item.settings.id === workID) ?? null : null;
}

// workIDFromArgs 从工具卡片的参数摘要里取出作品 ID（generate_work 的 args 形如 {"id":"…"}）。
function workIDFromArgs(args?: string): string {
  if (!args) return '';
  try {
    const id = (JSON.parse(args) as { id?: string }).id;
    return typeof id === 'string' ? id : '';
  } catch { return ''; }
}

// relativeTime 显示会话的相对更新时间。
function relativeTime(t: ReturnType<typeof useTranslator>, iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return t('@yovoice.assistant.justNow');
  if (minutes < 60) return t('@yovoice.assistant.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('@yovoice.assistant.hoursAgo', { count: hours });
  return new Date(iso).toLocaleDateString();
}
