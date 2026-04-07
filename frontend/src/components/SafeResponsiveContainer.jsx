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
  const [measuredSize, setMeasuredSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return undefined;

    const updateReadyState = () => {
      const rect = element.getBoundingClientRect();
      setMeasuredSize({
        width: Math.max(0, Math.round(rect.width || 0)),
        height: Math.max(0, Math.round(rect.height || 0)),
      });
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

  const isReady = isActive && measuredSize.width > 1 && measuredSize.height > 1;

  return (
    <div ref={hostRef} className={className}>
      {isReady ? (
        <ResponsiveContainer
          width={width === '100%' ? measuredSize.width : width}
          height={height === '100%' ? measuredSize.height : height}
        >
          {children}
        </ResponsiveContainer>
      ) : (
        fallback || defaultFallback
      )}
    </div>
  );
}

export default SafeResponsiveContainer;