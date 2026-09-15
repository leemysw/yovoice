// 在真实 WKWebView 中验证桥接、录音导入、播放和草稿保存。
const wait = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('界面等待超时');
};
const rpc = (method, data = {}) => new Promise((resolve, reject) => {
  const id = crypto.randomUUID();
  const timer = setTimeout(() => reject(new Error(`${method} 超时`)), 10000);
  window.chrome.webview.addEventListener('message', ({data: reply}) => {
    if (reply.id !== id) return;
    clearTimeout(timer);
    if (reply.error) reject(new Error(reply.error)); else resolve(reply.result);
  });
  window.chrome.webview.postMessage({id, method, data});
});
await wait(() => document.querySelector('textarea[aria-label="正文"]'));
const initial = await rpc('state.get');
if (!initial.desktop || !initial.state.runtimePath || initial.state.preferences.backend !== 'metal') throw new Error('原生内核未就绪');
const bytes = new Uint8Array(44 + 64000);
const view = new DataView(bytes.buffer);
const str = (offset, value) => [...value].forEach((c, i) => bytes[offset + i] = c.charCodeAt(0));
str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, 64000, true);
for (let i = 0; i < 32000; i++) view.setInt16(44 + i * 2, Math.sin(i * .15) * 10000, true);
let binary = ''; for (const value of bytes) binary += String.fromCharCode(value);
const voice = await rpc('voice.record', {name: 'Mac 原生测试音色', base64: btoa(binary)});
const button = label => [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
button('添加参考音频').click();
await wait(() => button('Mac 原生测试音色'));
button('Mac 原生测试音色').click();
await wait(() => button('试听当前音色'));
const player = document.querySelector('footer audio');
player.muted = true;
button('试听当前音色').click();
await wait(() => player.currentTime > 0 && !player.paused);
player.pause();
const response = await fetch(`/media/voices/${voice.fileName}`);
if (!response.ok) throw new Error('音频读取失败');
const context = new AudioContext(); const decoded = await context.decodeAudioData(await response.arrayBuffer()); await context.close();
if (decoded.duration !== 2) throw new Error('音频长度不正确');
const editor = document.querySelector('textarea[aria-label="正文"]');
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, '这是 macOS 原生窗口中的yovoice。');
editor.dispatchEvent(new Event('input', {bubbles:true}));
await wait(() => window.__workbenchDraft?.text === '这是 macOS 原生窗口中的yovoice。');
await rpc('draft.save', {...window.__workbenchDraft, voiceId: voice.id});
const final = await rpc('state.get');
if (final.state.voices.length !== 1) throw new Error('音色持久化失败');
return {desktop: initial.desktop, platform: window.__workbenchPlatform, backend: final.state.preferences.backend, audioSeconds: decoded.duration, playback: player.currentTime > 0, draft: final.state.drafts[0].text, pageTitle: document.title};
