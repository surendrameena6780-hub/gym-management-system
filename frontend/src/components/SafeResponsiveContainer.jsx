import React, { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer } from 'recharts';

const defaultFallback = (
  <div className="h-full w-full rounded-2xl border border-slate-100 bg-slate-50" />
);

const hasPositiveSize = (element) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

function SafeResponsiveContainer({
  children,
  fallback = null,
  isActive = true,
  width = '100%',
  height = '100%',
  className = 'h-full w-full',
}) {
  const hostRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return undefined;

    const updateReadyState = () => {
      setIsReady(hasPositiveSize(element));
    };

    updateReadyState();

    if (typeof ResizeObserver !== 'function') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateReadyState();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={className}>
      {isActive && isReady ? (
        <ResponsiveContainer width={width} height={height}>
          {children}
        </ResponsiveContainer>
      ) : (
        fallback || defaultFallback
      )}
    </div>
  );
}

export default SafeResponsiveContainer;