import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowRight, AudioWaveform, FileMusic, Mic, Music, Pencil } from 'lucide-react';
import { playParticles } from './intro-particles';

const kinds = [['text', Mic], ['story', Pencil], ['music', Music], ['score', FileMusic], ['sfx', AudioWaveform]] as const;
// 按钮在约 7.3 秒时出现，与 styles.css 中 .intro-cta 的动画延迟一致。
const buttonDelayMs = 7300;
const leaveMs = 800;

/**
 * 首次启动的开场画面（约 8 秒）：粒子汇成随声音起伏的 3D 球体，再聚成声波条；
 * 随后依次出现流光标题、标语、五种创作方式和「开始探索」，点击后淡出进入主界面。
 * 减少动态效果时直接显示最终画面。
 */
export function IntroScreen({ onStart }: { onStart: () => void }) {
  const t = useTranslator();
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [leaving, setLeaving] = useState(false);
  // 淡出结束后进入主界面的定时器；画面在此之前被卸载（如加载出错）时取消，不再回调。
  const leaveTimer = useRef(0);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stop = canvas.current ? playParticles(canvas.current, reduced) : () => {};
    // 按钮出现后把焦点交给它，键盘用户直接按回车即可进入。
    const timer = window.setTimeout(() => root.current?.querySelector<HTMLButtonElement>('button.intro-cta')?.focus(), reduced ? 0 : buttonDelayMs);
    return () => { stop(); window.clearTimeout(timer); window.clearTimeout(leaveTimer.current); };
  }, []);
  const start = () => {
    if (leaving) return;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(onStart, leaveMs);
  };
  return <VStack ref={root} as="section" className="intro-screen" data-leaving={leaving || undefined} role="dialog" aria-modal="true" aria-label="yovoice" gap={0}>
    <canvas ref={canvas} className="intro-canvas" aria-hidden />
    <StackItem as="span" className="intro-glow" aria-hidden />
    <VStack className="intro-copy" hAlign="center" gap={0}>
      <h1 className="intro-word" data-text="yovoice">yovoice</h1>
      <p className="intro-tagline">{t('@yovoice.intro.tagline')}</p>
      <HStack className="intro-kinds" gap={2} hAlign="center" wrap="wrap">
        {kinds.map(([kind, Icon]) => <HStack key={kind} as="span" className="intro-kind" gap={2} vAlign="center"><StackItem as="span" className="intro-kind-icon" aria-hidden><Icon size={14} /></StackItem>{t(`@yovoice.project.${kind}`)}</HStack>)}
      </HStack>
      <Button className="intro-cta" size="lg" label={t('@yovoice.intro.start')} onClick={start}>
        <StackItem as="span" className="intro-cta-sheen" aria-hidden />
        <Text type="inherit" color="inherit" className="intro-cta-label">{t('@yovoice.intro.start')}</Text>
        <ArrowRight className="intro-cta-arrow" size={18} strokeWidth={2.25} aria-hidden />
      </Button>
    </VStack>
  </VStack>;
}
