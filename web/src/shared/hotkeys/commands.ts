// 快捷键命令表：设置页按这里的三级分类展示（功能区 › 页面或面板 › 功能块），各页面用命令 id 注册处理函数。
// 名称与说明的文案键由 id 推出：@yovoice.hotkeys.cmd.<id>、@yovoice.hotkeys.hint.<id>；分类标题为 @yovoice.hotkeys.node.<节点 id>。
// key 是默认按键（写法见 keys.ts），win 是 Windows 与 Linux 上不同的默认值；fixed 的条目只做展示，由输入框或组件自己处理，不能修改。

export interface HotkeyCommand {
  id: string;
  /** 默认按键；fixed 条目可用 | 列出几组。 */
  key: string;
  win?: string;
  fixed?: boolean;
  /** 只在 macOS 上有的固定按键。 */
  macOnly?: boolean;
  /** 按键里的 # 代表 1–range 的数字。 */
  range?: number;
  hint?: boolean;
  /** 一级功能区 id。 */
  area: string;
  /** 冲突检查的范围：同一范围内不能重复，全局范围（scope 为 global）与任何范围都不能重复。 */
  scope: string;
  /** 所在的二级、三级节点 id。 */
  group: string;
  sub?: string;
  /** 在输入框里也会触发的命令（注册时带 inInput），改键时必须带修饰键，Esc 除外；全局范围的命令总是如此。 */
  modifier?: boolean;
}

type Spec = [id: string, key: string, options?: Partial<Pick<HotkeyCommand, 'win' | 'fixed' | 'macOnly' | 'range' | 'hint' | 'modifier'>>];
export interface HotkeyNode { id: string; items?: Spec[]; subs?: HotkeyNode[]; /** 冲突检查的范围，默认是节点自己的 id；同一页面上的几块共用一个范围。 */ scope?: string }
export interface HotkeyArea { id: string; groups: HotkeyNode[] }

const fixed = { fixed: true } as const;
const hint = { hint: true } as const;

export const hotkeyTree: HotkeyArea[] = [
  { id: 'global', groups: [
    { id: 'global.nav', scope: 'global', items: [
      ['global.new', 'mod+N', hint],
      ['global.page.text', 'mod+1'],
      ['global.page.transcribe', 'mod+2'],
      ['global.page.story', 'mod+3'],
      ['global.page.music', 'mod+4'],
      ['global.page.voices', 'mod+5'],
      ['global.settings', 'mod+,'],
      ['global.back', 'mod+[', hint],
      ['global.nextTab', 'ctrl+tab'],
      ['global.prevTab', 'ctrl+shift+tab'],
    ] },
    { id: 'global.panels', scope: 'global', items: [
      ['global.assistant', 'mod+J'],
      ['global.sidebar', 'mod+B'],
      // Windows 上 Ctrl+Alt 等同 AltGr（克罗地亚、匈牙利等布局用 AltGr+B 打 {），默认改用 Ctrl+Shift。
      ['global.inspector', 'alt+mod+B', { win: 'ctrl+shift+B' }],
      ['global.cheatsheet', 'mod+/'],
    ] },
    { id: 'global.common', scope: 'global', items: [
      ['global.cancel', 'mod+.', { win: 'ctrl+shift+.', hint: true }],
      ['global.playPause', 'mod+shift+space'],
    ] },
    { id: 'global.bottom', subs: [
      { id: 'global.bottom.player', items: [
        ['player.play', 'space'],
        ['player.back', 'left'],
        ['player.forward', 'right'],
        ['player.start', 'home'],
        ['player.end', 'end'],
        ['player.mute', 'M'],
      ] },
      { id: 'global.bottom.timeline', items: [
        ['timeline.play', 'space'],
        ['timeline.playSelection', 'shift+space'],
        ['timeline.preview', 'P'],
        ['timeline.regenerate', 'mod+shift+enter'],
        ['timeline.duplicate', 'mod+D'],
        ['timeline.split', 'mod+I'],
        ['timeline.prevEdge', 'alt+left'],
        ['timeline.nextEdge', 'alt+right'],
        ['timeline.start', 'home'],
        ['timeline.end', 'end'],
        ['timeline.mute', 'M'],
        ['timeline.solo', 'S'],
        ['timeline.snap', 'G'],
        ['timeline.zoomIn', 'mod+='],
        ['timeline.zoomOut', 'mod+-'],
        ['timeline.zoomFit', 'mod+0'],
        ['timeline.zoomSelection', 'alt+mod+0', { win: 'ctrl+shift+0' }],
        ['timeline.export', 'mod+E'],
        ['timeline.undoRedo', 'mod+Z|mod+shift+Z', { fixed: true, win: 'ctrl+Z|ctrl+shift+Z|ctrl+Y' }],
        ['timeline.clipboard', 'mod+C|mod+V|mod+A', fixed],
        ['timeline.delete', 'backspace|shift+backspace', { fixed: true, win: 'delete|shift+delete' }],
        ['timeline.nudge', 'left|right|up|down|shift+left|shift+right', { fixed: true, hint: true }],
      ] },
    ] },
  ] },
  { id: 'create', groups: [
    { id: 'create.edit', scope: 'create', items: [
      ['create.generate', 'mod+enter'],
      ['create.pronounce', 'mod+shift+P', hint],
      ['create.import', 'mod+O'],
    ] },
    { id: 'create.inspector', scope: 'create', items: [
      ['create.character', 'mod+shift+C'],
      ['create.reference', 'mod+shift+A'],
    ] },
    { id: 'create.versions', scope: 'create', items: [
      ['create.history', 'mod+shift+H'],
      ['create.export', 'mod+E'],
    ] },
  ] },
  { id: 'transcribe', groups: [
    { id: 'transcribe.list', items: [
      ['transcribe.upload', 'mod+O'],
      ['transcribe.record', 'mod+shift+R'],
      ['transcribe.search', 'mod+F'],
    ] },
    { id: 'transcribe.edit', scope: 'transcribe.edit', subs: [
      { id: 'transcribe.edit.play', items: [
        ['transcribe.playPause', 'space', hint],
        ['transcribe.playLine', 'mod+enter', hint],
        ['transcribe.prevLine', 'alt+up'],
        ['transcribe.nextLine', 'alt+down'],
        ['transcribe.continuous', 'mod+shift+L'],
      ] },
      { id: 'transcribe.edit.lines', items: [
        ['transcribe.find', 'mod+F'],
        ['transcribe.findNext', 'mod+G'],
        ['transcribe.findPrev', 'mod+shift+G'],
        ['transcribe.deleteLine', 'mod+shift+K'],
        ['transcribe.undo', 'mod+Z', fixed],
        ['transcribe.redo', 'mod+shift+Z', { fixed: true, win: 'ctrl+shift+Z|ctrl+Y' }],
        ['transcribe.splitLine', 'enter', fixed],
        ['transcribe.joinPrev', 'backspace', { fixed: true, hint: true }],
        ['transcribe.joinNext', 'delete', { fixed: true, hint: true }],
        ['transcribe.emacsDelete', 'ctrl+H|ctrl+D', { fixed: true, macOnly: true }],
      ] },
      { id: 'transcribe.edit.output', items: [
        ['transcribe.export', 'mod+E'],
        ['transcribe.prevPage', 'mod+shift+['],
        ['transcribe.nextPage', 'mod+shift+]'],
      ] },
    ] },
  ] },
  { id: 'story', groups: [
    { id: 'story.cues', scope: 'story.cues', subs: [
      { id: 'story.cues.generate', items: [
        ['story.generate', 'mod+enter'],
        ['story.regenerate', 'mod+shift+enter'],
      ] },
      { id: 'story.cues.edit', items: [
        ['story.prevCue', 'alt+up'],
        ['story.nextCue', 'alt+down'],
        ['story.insert', 'alt+enter'],
        ['story.deleteCue', 'mod+shift+K'],
        ['story.prevPage', 'mod+shift+['],
        ['story.nextPage', 'mod+shift+]'],
        ['story.splitCue', 'enter', fixed],
        ['story.joinPrev', 'backspace', { fixed: true, hint: true }],
        ['story.joinNext', 'delete', { fixed: true, hint: true }],
        ['story.emacsDelete', 'ctrl+H|ctrl+D', { fixed: true, macOnly: true }],
      ] },
      { id: 'story.cues.speakers', items: [
        // macOS 上 ⌥ 加数字在台词框里是打字符（德语布局 ⌥5 是 [），默认用 ⌃⌥；Windows 与 Linux 用 Alt。
        ['story.speaker', 'ctrl+alt+#', { win: 'alt+#', range: 9, hint: true }],
        ['story.speakerMenu', 'mod+shift+C'],
      ] },
    ] },
    { id: 'story.list', items: [
      ['story.importBook', 'mod+O'],
    ] },
  ] },
  { id: 'music', groups: [
    { id: 'music.song', subs: [
      { id: 'music.song.edit', items: [
        ['music.generate', 'mod+enter'],
        ['music.nowPlaying', 'mod+shift+N'],
        ['music.instrumental', 'mod+shift+I'],
        ['music.section', 'mod+shift+T', hint],
        // Ctrl+Shift+F 在 Windows 与 Linux 的中文输入法里是简繁切换，默认换成 Ctrl+Shift+L。
        ['music.expandLyrics', 'mod+shift+F', { win: 'ctrl+shift+L' }],
        ['music.hum', 'mod+shift+R'],
        ['music.stems', 'mod+shift+S', hint],
        ['music.history', 'mod+shift+H'],
        ['music.export', 'mod+E'],
      ] },
      { id: 'music.song.nowPlaying', items: [
        ['nowPlaying.play', 'space'],
        ['nowPlaying.back', 'left'],
        ['nowPlaying.forward', 'right'],
        ['nowPlaying.switch', 'B'],
        ['nowPlaying.align', 'A'],
        ['nowPlaying.sync', 'C'],
        ['nowPlaying.words', 'W'],
        ['nowPlaying.fullscreen', 'F'],
        ['nowPlaying.lyricStyle', 'L'],
        ['nowPlaying.exportLrc', 'mod+E'],
        ['nowPlaying.mark', 'down|enter', fixed],
        ['nowPlaying.unmark', 'backspace', fixed],
        ['nowPlaying.close', 'esc', fixed],
      ] },
      { id: 'music.song.words', items: [
        ['words.earlierBig', 'alt+left'],
        ['words.laterBig', 'alt+right'],
        ['words.playLine', 'P'],
        ['words.tap', 'T'],
        ['words.save', 'mod+S'],
        ['words.lines', 'up|down', fixed],
        ['words.shift', 'left|right', { fixed: true, hint: true }],
        ['words.anchor', 'enter', fixed],
        ['words.undo', 'mod+Z', fixed],
        ['words.exit', 'esc', fixed],
      ] },
      { id: 'music.song.stems', items: [
        ['stems.play', 'space'],
        ['stems.solo', '#', { range: 6, hint: true }],
        ['stems.mute', 'shift+#', { range: 6 }],
        ['stems.back', 'left'],
        ['stems.forward', 'right'],
        ['stems.export', 'mod+E'],
      ] },
    ] },
    { id: 'music.score', items: [
      ['score.render', 'mod+enter'],
      ['score.import', 'mod+O'],
      ['score.export', 'mod+E'],
      ['score.stems', 'mod+shift+S'],
      ['score.prevTrack', 'up'],
      ['score.nextTrack', 'down'],
      ['score.mute', 'M'],
      ['score.instrument', 'I'],
      ['score.zoomIn', 'mod+='],
      ['score.zoomOut', 'mod+-'],
      ['score.zoomFit', 'mod+0'],
    ] },
    { id: 'music.sfx', items: [
      ['sfx.generate', 'mod+enter'],
      ['sfx.history', 'mod+shift+H'],
      ['sfx.export', 'mod+E'],
    ] },
  ] },
  { id: 'voices', groups: [
    { id: 'voices.voices', subs: [
      { id: 'voices.voices.list', items: [
        ['voices.search', 'mod+F'],
        ['voices.preview', 'space'],
      ] },
      { id: 'voices.voices.editor', items: [
        ['voices.audition', 'mod+enter'],
        ['voices.save', 'mod+S'],
        ['voices.saveApply', 'mod+shift+S'],
        ['voices.close', 'esc', fixed],
      ] },
    ] },
    { id: 'voices.refs', subs: [
      { id: 'voices.refs.list', items: [
        ['refs.search', 'mod+F'],
        ['refs.preview', 'space'],
      ] },
      { id: 'voices.refs.editor', items: [
        ['refs.save', 'mod+S'],
      ] },
      { id: 'voices.refs.picker', items: [
        ['picker.record', 'mod+shift+R'],
        ['picker.import', 'mod+O'],
      ] },
    ] },
  ] },
  { id: 'ocho', groups: [
    { id: 'ocho.panel', items: [
      ['ocho.minimize', 'esc', { hint: true, modifier: true }],
      ['ocho.send', 'enter', fixed],
      ['ocho.newline', 'shift+enter', fixed],
    ] },
  ] },
];


export const hotkeyCommands: HotkeyCommand[] = hotkeyTree.flatMap(area => area.groups.flatMap(group =>
  (group.subs ?? [group]).flatMap(node => (node.items ?? []).map(([id, key, options]) => {
    const sub = group.subs ? node.id : undefined;
    return { id, key, ...options, area: area.id, group: group.id, sub, scope: (sub ? node.scope : undefined) ?? group.scope ?? node.id };
  }))));

export const hotkeyCommand = new Map(hotkeyCommands.map(command => [command.id, command]));

// 同时生效的范围：底部播放区在编辑页下方，与编辑页的命令同时可用——多轨时间线只出现在带时间线的语音作品与故事配音下方，
// 单轨播放条出现在语音生成、音乐、编曲与音效下方；逐字歌词编辑在播放页里打开，播放页的命令照常可用。冲突检查把它们当作同一范围。
const together: [string, string[]][] = [
  ['global.bottom.player', ['create', 'music.song.edit', 'music.score', 'music.sfx']],
  ['global.bottom.timeline', ['create', 'story.cues']],
  ['music.song.nowPlaying', ['music.song.words']],
];
/** 两个范围的命令会不会同时生效：同一范围、一方是全局，或属于上面列出的同时生效的范围。 */
export function scopesMeet(a: string, b: string): boolean {
  return a === b || a === 'global' || b === 'global' || together.some(([scope, others]) => (scope === a && others.includes(b)) || (scope === b && others.includes(a)));
}
export type HotkeyId = string;
