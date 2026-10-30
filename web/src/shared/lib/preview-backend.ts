// 浏览器预览的本地后端入口：client.ts 按需动态加载本模块（typeof import('./preview-backend')），这里的导出面须保持不变。
// 实现按职责放在 preview/ 下：store（localStorage 状态与备份）、blobs（IndexedDB 音频）、rpc（方法分发、审计日志与测试钩子）、
// assistant（助手模拟）、melody（ABC 旋律读取与改写）、media（音频导入解码与媒体地址）。
export { subscribePreview } from './preview/store';
export { previewCall } from './preview/rpc';
export { previewImportTimeline, previewImportTimelineGeneration, previewImportVoice, previewMediaUrl } from './preview/media';
