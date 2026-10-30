/** 把数值夹在 [low, high] 之间，默认 0~1。 */
export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
