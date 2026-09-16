import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Selector } from '@astryxdesign/core/Selector';
import { Download, FolderOpen, FolderCog, FilePlus, Check, Cpu, ArrowUpRight, ChevronRight, Pause, Trash2 } from 'lucide-react';
import { call, isMac } from '../../shared/lib/client';
import { formatSize, type ModelPackage, type State, type Draft } from '../../shared/workbench';
export function Settings({ state, catalog, draft, run }: { state: State; catalog: ModelPackage[]; draft: Draft; run: (task: () => Promise<unknown>) => void }) {
  const [license, setLicense] = useState<string | null>(null);
  const [tab, setTab] = useState('models'); const busy = state.activity?.status === 'running';
  const preferences = state.preferences;
  const runtimeReady = !!state.runtimePath && state.runtimeBackend === preferences.backend;
  return <VStack className="settings-page" gap={6}>
    <header><h1>模型与引擎</h1></header>
    <TabList value={tab} onChange={setTab} role="tablist" hasDivider><Tab value="models" label="模型" panelId="models-panel" /><Tab value="engine" label="推理引擎" panelId="engine-panel" /></TabList>
    {tab === 'models' ? <VStack gap={5} id="models-panel" role="tabpanel" aria-label="模型">
      <HStack className="settings-toolbar" hAlign="between" vAlign="center" gap={4} wrap="wrap">
        <HStack gap={3} vAlign="center"><p className="muted">下载来源</p><Selector size="sm" placement="below" label="下载来源" isLabelHidden value={preferences.downloadSource} options={[{ value: 'modelscope', label: 'ModelScope 魔搭' }, { value: 'huggingface', label: 'Hugging Face' }, { value: 'mirror', label: 'HF Mirror · 第三方镜像' }]} onChange={downloadSource => run(() => call('preferences.save', { ...preferences, downloadSource }))} width="calc(var(--spacing-10) * 6)" className="download-source" /></HStack>
        <HStack gap={2}><Button size="sm" label="导入 GGUF" icon={<FilePlus size={16} />} isDisabled={busy} onClick={() => run(() => call('model.import'))} /><Button size="sm" label="指定目录" icon={<FolderOpen size={16} />} isDisabled={busy} onClick={() => run(() => call('model.import', { directory: true }))} /></HStack>
      </HStack>
      <section className="model-list">{catalog.map(model => {
        const installed = state.models.find(m => m.id === model.id);
        const activity = state.activity;
        const download = activity?.kind === 'download' && (activity.modelId === model.id || (!activity.modelId && activity.total === model.size)) && activity.status !== 'completed' ? activity : null;
        const downloading = download?.status === 'running';
        const removeBlocked = busy && !(activity?.kind === 'download' && activity.modelId && activity.modelId !== model.id);
        return <VStack className="model-row" key={model.id} gap={3}><HStack className="model-summary" gap={5} vAlign="center" wrap="wrap">
          <VStack className="grow" gap={1}><HStack gap={3} vAlign="center" wrap="wrap"><h3>{model.name}</h3><small className="precision">{model.precision}</small><small className="model-size">{formatSize(model.size)}</small>{installed ? <small className="ready"><Check size={12} />{draft.modelId === model.id ? '正在使用' : '已校验'}</small> : null}</HStack><small>{model.family === 'voxcpm2' ? '30 种语言 · 48 kHz · 声音设计与音色克隆' : model.version === '2.5' ? '中文、英语、日语、西班牙语、阿拉伯语' : '中文、英语'}</small>{installed ? <small className="model-path" title={installed.path}>{installed.path}</small> : null}</VStack>
          {downloading ? <Button size="sm" label="暂停" icon={<Pause size={16} />} onClick={() => run(() => call('operation.cancel'))} /> : installed ? <Button size="sm" label="移除模型" icon={<Trash2 size={16} />} isDisabled={removeBlocked} tooltip={removeBlocked ? '请先结束相关操作，再移除此模型。' : '解除模型登记，保留本地文件'} onClick={() => run(() => call('model.forget', { id: model.id }))} /> : <Button size="sm" label={download ? '继续下载' : '下载模型'} icon={<Download size={16} />} isDisabled={busy} onClick={() => run(() => call('model.download', { id: model.id }))} />}
        </HStack>
        {download ? <VStack className="model-download" gap={2} role="status" aria-label={`${model.name} ${model.precision} 下载进度`}>
          <HStack hAlign="between" gap={3}><small>{downloading ? (download.received >= model.size ? '正在校验' : '正在下载') : download.status === 'failed' ? '下载未完成' : '已暂停'}</small><small>{formatSize(download.received)} / {formatSize(model.size)}</small></HStack>
          <progress aria-label={`${model.name} ${model.precision} 下载进度`} value={download.received} max={model.size} />
        </VStack> : null}
        </VStack>;
      })}</section>
      <VStack gap={2}>
      <HStack className="settings-directory" hAlign="between" gap={4} vAlign="center"><VStack className="grow" gap={1}><h3>模型保存位置</h3><small className="model-path">{preferences.modelDirectory ?? '应用数据目录 / models'}</small></VStack><HStack className="directory-actions" gap={2}><Button size="sm" label="打开文件夹" icon={<FolderOpen size={16} />} onClick={() => run(() => call('model.directory.open'))} /><Button size="sm" label="更改位置" icon={<FolderCog size={16} />} isDisabled={busy} onClick={() => run(() => call('model.directory'))} /></HStack></HStack>
      <details className="settings-help"><summary><ChevronRight size={16} aria-hidden="true" />模型与文件说明</summary><p className="helper muted">支持上述 audio.cpp GGUF 包，导入后自动校验。移除模型仅解除登记，保留本地文件；更改保存位置仅影响后续下载。</p></details>
      </VStack>
      <p className="helper muted">IndexTTS 遵循 bilibili 模型使用协议；VoxCPM2 使用 Apache-2.0 许可。<Button size="sm" label="IndexTTS 协议" variant="ghost" onClick={() => run(async () => { const response = await fetch('./model-license.txt'); if (!response.ok) throw new Error('无法读取协议'); setLicense(await response.text()); })} /></p>
    </VStack> : <VStack className="engine-settings" gap={5} id="engine-panel" role="tabpanel" aria-label="推理引擎">
      <HStack className="runtime-heading" gap={3} vAlign="center"><Cpu size={22} strokeWidth={1.5} /><h2>audio.cpp</h2><small>v0.7.4</small></HStack>
      <VStack gap={0}>
        <HStack className="engine-setting-row" hAlign="between" vAlign="center" gap={4} wrap="wrap"><h3>计算设备</h3><Selector size="sm" placement="below" label="计算设备" isLabelHidden value={preferences.backend} options={[{ value: 'cpu', label: 'CPU' }, ...(isMac ? [{ value: 'metal', label: 'Apple GPU · Metal' }] : [{ value: 'cuda', label: 'NVIDIA GPU · CUDA 12.4' }, { value: 'vulkan', label: 'Vulkan GPU · 实验性' }])]} onChange={backend => run(() => call('preferences.save', { ...preferences, backend }))} isDisabled={busy} width="min(100%, calc(var(--spacing-10) * 6))" className="compute-device" /></HStack>
        <HStack className="engine-setting-row" hAlign="between" gap={4} vAlign="center" wrap="wrap"><VStack className="grow" gap={1}><h3>推理内核</h3><small>{runtimeReady ? '已安装 · 可以开始生成' : '未就绪 · 请安装所选设备的内核'}</small></VStack><Button size="sm" label={runtimeReady ? '重新安装' : '安装内核'} isDisabled={busy} onClick={() => run(() => call('runtime.install'))} /></HStack>
        <HStack className="engine-setting-row" hAlign="between" gap={4} vAlign="center"><h3>诊断日志</h3><Button size="sm" label="打开日志目录" icon={<ArrowUpRight size={15} />} variant="ghost" onClick={() => run(() => call('logs.open'))} /></HStack>
      </VStack>
      <details className="settings-help engine-help"><summary><ChevronRight size={15} aria-hidden="true" />安装与排障说明</summary><VStack gap={2}><p className="helper">{isMac ? '应用内置 Metal 内核，也可切换 CPU。' : '应用内置 CPU 内核；选择 NVIDIA GPU 后可下载 CUDA 内核，无需安装 Python。'}</p><p className="helper">GPU 需要兼容的驱动；启动或生成失败时，可尝试切换 CPU。取消生成会释放引擎，下次生成需重新加载。</p></VStack></details>
    </VStack>}

    {license ? <Dialog isOpen onOpenChange={open => { if (!open) setLicense(null); }} width={680} padding={6}><VStack gap={4}><h2>模型使用协议</h2><pre className="license-text">{license}</pre><Button size="sm" label="关闭协议" onClick={() => setLicense(null)} /></VStack></Dialog> : null}
  </VStack>;
}
