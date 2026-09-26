import { useMemo } from 'react';
import { manifest } from '../lib/humation/assets';
import { createAvatar, fnv1a } from '../lib/humation/create-avatar';
import { nexusParts } from '../lib/humation/nexus-parts';

const assets = { ...manifest, parts: [...manifest.parts, ...nexusParts] };
// 沿用 Nexus 的素材背景色，资源 ID 决定头像，重命名和刷新不会改变。
const backgrounds = ['8B3DFF', 'B5A1F7', '96C9F4', '8ED9C4', 'F3CE75', 'F6A6B2', 'F5B58C', 'C2D98B'];

export function SeededAvatar({ seed }: { seed: string }) {
  const src = useMemo(() => createAvatar(assets, {
    seed,
    background: backgrounds[fnv1a(`${seed}:background`) % backgrounds.length],
  }).toDataUri(), [seed]);
  return <img className="library-avatar" src={src} alt="" />;
}
