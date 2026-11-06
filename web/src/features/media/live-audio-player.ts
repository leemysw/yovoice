import type { LiveAudioEvent } from '../../shared/lib/bridge';

export type LivePlaybackState = { active: boolean; error: string };

// 片段逐个解码并排入同一音频时钟，取消后尚未完成的异步解码也不能重新出声。
export class LiveAudioPlayer {
  private context?: AudioContext;
  private gain?: GainNode;
  private nodes = new Set<AudioBufferSourceNode>();
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;
  private id = '';
  private project = '';
  private sequence = 0;
  private nextTime = 0;
  private armed = false;
  private requestDone = false;
  private volume = 1;
  private pendingBytes = 0;
  private listeners = new Set<(state: LivePlaybackState) => void>();
  private state: LivePlaybackState = { active: false, error: '' };

  constructor(private createContext = () => new AudioContext()) {}
  subscribe(listener: (state: LivePlaybackState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private publish(active: boolean, error = '') { this.state = { active, error }; this.listeners.forEach(listener => listener(this.state)); }
  prepare(project: string) {
    this.stop(); this.project = project; this.armed = true; this.requestDone = false;
    try {
      this.context = this.createContext(); this.gain = this.context.createGain();
      this.gain.gain.value = this.volume; this.gain.connect(this.context.destination);
      const epoch = this.epoch;
      void this.context.resume().catch(() => { if (epoch === this.epoch) this.stop('@yovoice.runtime.audioUnavailable'); });
    } catch { this.stop('@yovoice.runtime.audioUnavailable'); }
  }
  setProject(project: string) { if (this.project && this.project !== project) this.stop(); this.project = project; }
  setVolume(volume: number) { this.volume = volume; if (this.gain) this.gain.gain.value = volume; }
  stop(error = '') {
    this.epoch++; this.armed = false; this.id = ''; this.nextTime = 0; this.pendingBytes = 0;
    this.nodes.forEach(source => { source.onended = null; source.stop(); source.disconnect(); }); this.nodes.clear();
    const context = this.context; this.context = undefined; this.gain = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.queue = Promise.resolve(); this.publish(false, error);
  }
  finishRequest() { this.requestDone = true; this.drain(); }
  private drain() {
    if (this.requestDone && !this.nodes.size && !this.pendingBytes) this.stop();
  }
  receive(event: LiveAudioEvent) {
    if (event.event === 'audio-disconnected') { if (this.armed) this.stop('@yovoice.runtime.audioDisconnected'); return; }
    if (!this.armed || event.projectId !== this.project) return;
    if (event.cancelled) { this.stop(); return; }
    const epoch = this.epoch, bytes = event.audio?.length ?? 0;
    this.pendingBytes += bytes;
    if (this.pendingBytes > 64 * 1024 * 1024) { this.stop('@yovoice.runtime.audioBufferFull'); return; }
    this.queue = this.queue.then(async () => {
      if (epoch !== this.epoch || !this.armed) return;
      if (event.event === 'audio-request-end') { this.finishRequest(); return; }
      if (event.start) { this.id = event.id ?? ''; this.sequence = 0; return; }
      if (event.id !== this.id || event.sequence !== this.sequence + 1) { this.stop('@yovoice.runtime.audioDisconnected'); return; }
      this.sequence++;
      if (event.end) { this.drain(); return; }
      const context = this.context, gain = this.gain;
      if (!event.audio || !context || !gain) return;
      const binary = atob(event.audio);
      const data = Uint8Array.from(binary, char => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(data.buffer);
      if (epoch !== this.epoch || !this.armed || this.context !== context) return;
      if (this.nextTime - context.currentTime + buffer.duration > 120) { this.stop('@yovoice.runtime.audioBufferFull'); return; }
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(gain);
      const when = Math.max(context.currentTime + 0.03, this.nextTime);
      source.onended = () => { this.nodes.delete(source); source.disconnect(); this.drain(); };
      source.start(when); this.nodes.add(source); this.nextTime = when + buffer.duration;
      this.publish(true);
    }).catch(() => { if (epoch === this.epoch) this.stop('@yovoice.runtime.audioUnavailable'); }).finally(() => {
      if (epoch === this.epoch) { this.pendingBytes = Math.max(0, this.pendingBytes - bytes); this.drain(); }
    });
  }
}

export const liveAudioPlayer = new LiveAudioPlayer();
export function prepareLivePlayback(project: string) { window.dispatchEvent(new Event('yovoice-live-playback')); liveAudioPlayer.prepare(project); }
