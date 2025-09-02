import { useEffect, useRef, useState } from 'react';

type Opts = { duration?: number; easing?: (t:number)=>number };

const easeOutCubic = (t:number) => 1 - Math.pow(1 - t, 3);

export function useAnimatedNumber(target: number | undefined, opts: Opts = {}) {
  const { duration = 300, easing = easeOutCubic } = opts;
  const [display, setDisplay] = useState<number | undefined>(target);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const fromRef = useRef<number>(target ?? 0);
  const toRef   = useRef<number>(target ?? 0);

  useEffect(() => {
    if (typeof target !== 'number' || !Number.isFinite(target)) {
      // če ni številka, pusti trenutni display
      return;
    }
    // nastavi animacijo
    if (typeof display === 'number') fromRef.current = display;
    else fromRef.current = target; // prvič brez animacije

    toRef.current = target;
    startRef.current = performance.now();

    const tick = (now:number) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const k = easing(t);
      const val = fromRef.current + (toRef.current - fromRef.current) * k;
      setDisplay(val);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}
