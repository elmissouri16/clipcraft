import { useEffect, useRef, useState } from 'react';

// Only consumers that need React values subscribe. The root editor stores seek
// and pause positions; the preview and transport paint from the live clock.
export function useClockTime(clockRef, pausedTime, playing, hz = 10) {
  const [sample, setSample] = useState(pausedTime);
  const latest = useRef({ clockRef, pausedTime });
  latest.current = { clockRef, pausedTime };
  useEffect(() => {
    if (!playing) return;
    let raf, last = -Infinity;
    const tick = stamp => {
      if (stamp - last >= 1000 / hz) {
        const value = latest.current.clockRef?.current?.time ?? latest.current.pausedTime;
        setSample(value);last = stamp;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, hz]);
  return playing ? (clockRef?.current?.time ?? sample) : pausedTime;
}
