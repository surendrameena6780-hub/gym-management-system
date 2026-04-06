export const reportClientError = (scope, error, extra = null) => {
  if (!import.meta.env.DEV) {
    return;
  }

  const message = error?.message || String(error || 'Unknown client error');
  if (extra) {
    console.warn(`[${scope}] ${message}`, extra);
    return;
  }

  console.warn(`[${scope}] ${message}`);
};