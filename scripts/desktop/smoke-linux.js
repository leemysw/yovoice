// 在真实 WebKitGTK 中验证桥接、录音导入、播放和草稿保存。
const wait = async (predicate, what = '') => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('界面等待超时：' + (what || predicate.toString()));
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
const initial = await rpc('state.get');
if (!initial.desktop || !initial.state.runtimePath || initial.state.preferences.backend !== 'cpu') throw new Error('内置 CPU 内核未就绪');
await rpc('preferences.save', {...initial.state.preferences, introSeen: true, tourSeen: true});
const editorSelector = 'textarea[aria-label="正文"]';
const visible = element => element?.getBoundingClientRect().width > 0;
const workbenchReady = () => visible(document.querySelector(editorSelector)) && !document.querySelector('.intro-screen, .guide-tour');
await wait(workbenchReady, '语音工作台');

// WebKitGTK 2.50 曾在打开模型列表或隐藏设置页时卡死；等待实际渲染及关闭，而不是只检查点击事件。
const model = document.querySelector('.model-selector [role="combobox"]');
if (!visible(model)) throw new Error('模型选择器不可见');
model.click();
const modelList = () => document.getElementById(model.getAttribute('aria-controls'));
await wait(() => visible(modelList()), '模型列表');
const modelOptions = modelList().querySelectorAll('[role="option"]').length;
const selectedModel = modelList().querySelector('[role="option"][aria-selected="true"]');
if (!selectedModel || modelOptions < 2) throw new Error('模型列表缺少选项');
selectedModel.click();
await wait(() => model.getAttribute('aria-expanded') === 'false' && !visible(modelList()), '关闭模型列表');
const settings = () => visible(document.querySelector('.settings-page'));
document.querySelector('[data-testid="nav-settings"]').click();
await wait(settings, '设置');
document.querySelector('[data-testid="nav-text"]').click();
await wait(() => workbenchReady() && !settings(), '从设置返回语音工作台');

const bytes = new Uint8Array(44 + 64000);
const view = new DataView(bytes.buffer);
const str = (offset, value) => [...value].forEach((c, i) => bytes[offset + i] = c.charCodeAt(0));
str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, 64000, true);
for (let i = 0; i < 32000; i++) view.setInt16(44 + i * 2, Math.sin(i * .15) * 10000, true);
let binary = ''; for (const value of bytes) binary += String.fromCharCode(value);
const voice = await rpc('voice.record', {name: 'Linux 原生测试音色', base64: btoa(binary)});
const button = label => [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
button('添加参考音频').click();
await wait(() => button('Linux 原生测试音色'));
button('Linux 原生测试音色').click();
await wait(() => button('使用所选参考音频'));
button('使用所选参考音频').click();
await wait(() => button('试听当前音色'));
const player = document.querySelector('footer audio');
player.muted = true;
button('试听当前音色').click();
await wait(() => player.currentTime > 0 && !player.paused);
player.pause();
const response = await fetch(`/media/voices/${voice.fileName}`);
if (!response.ok) throw new Error('音频读取失败');
const context = new AudioContext(); const decoded = await context.decodeAudioData(await response.arrayBuffer()); await context.close();
// WebKitGTK 解码时会重采样到音频设备的采样率，时长允许几毫秒误差。
if (Math.abs(decoded.duration - 2) > 0.01) throw new Error('音频长度不正确：' + decoded.duration);
const editor = document.querySelector(editorSelector);
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, '这是 Linux 原生窗口中的yovoice。');
editor.dispatchEvent(new Event('input', {bubbles:true}));
// __workbenchDraft 只在存在未保存修改时有值，自动保存完成后会清空，先取出快照再使用。
let edited;
await wait(() => (edited = window.__workbenchDraft)?.text === '这是 Linux 原生窗口中的yovoice。');
await rpc('draft.save', {...edited, voiceId: voice.id});
const final = await rpc('state.get');
if (final.state.voices.length !== 1) throw new Error('音色持久化失败');
return {desktop: initial.desktop, platform: window.__workbenchPlatform, backend: final.state.preferences.backend, modelOptions, settingsRoundTrip: true, audioSeconds: Math.round(decoded.duration * 100) / 100, playback: player.currentTime > 0, draft: final.state.drafts[0].text, pageTitle: document.title};
