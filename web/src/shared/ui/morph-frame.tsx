import type { ReactNode } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { useHeightMorph } from './use-height-morph';

/** 高度随内容平滑过渡的外框：children 只能是一个元素（作为内容），见 useHeightMorph。 */
export function MorphFrame({ className, children }: { className?: string; children: ReactNode }) {
  const frame = useHeightMorph<HTMLDivElement>();
  return <VStack ref={frame} className={className} gap={0}>{children}</VStack>;
}
