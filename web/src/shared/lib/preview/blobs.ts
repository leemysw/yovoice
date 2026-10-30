// 浏览器预览的音频存储：参考音频、生成结果与导入素材的 WAV 以 blob 存在 IndexedDB（voice-workbench-audio 库的 audio 仓库），键为文件名。
function database(): Promise<IDBDatabase> { return new Promise((resolve, reject) => {
  const request = indexedDB.open('voice-workbench-audio', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('audio');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
}); }

// 传入 value 时写入并原样返回；不传时读取，缺失返回 undefined。每次操作单独开关数据库连接。
export async function blobStore(key: string, value?: Blob): Promise<Blob | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction('audio', value ? 'readwrite' : 'readonly');
    const request = value ? transaction.objectStore('audio').put(value, key) : transaction.objectStore('audio').get(key);
    transaction.oncomplete = () => resolve(value ?? request.result); transaction.onerror = () => reject(transaction.error);
  }); } finally { db.close(); }
}

export async function blobDelete(key: string): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
