import { useEffect, useRef, useState } from 'react';

const useCountUp = (target, duration = 900) => {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const currentValueRef = useRef(0);
  const previousTargetRef = useRef(null);

  useEffect(() => {
    const end = Number(target) || 0;
    if (previousTargetRef.current === end) {
      return undefined;
    }

    previousTargetRef.current = end;
    const start = currentValueRef.current;
    if (start === end) {
      return undefined;
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(start + (end - start) * eased);
      currentValueRef.current = nextValue;
      setDisplay(nextValue);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [target, duration]);

  return display;
};

export default useCountUp;