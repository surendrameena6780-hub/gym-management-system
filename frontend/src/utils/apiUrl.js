const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

const normalizeConfiguredOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

export const getApiOrigin = () => {
  const configured = normalizeConfiguredOrigin(import.meta.env.VITE_API_URL);
  const forceDirectApi = String(import.meta.env.VITE_FORCE_DIRECT_API || '').trim().toLowerCase() === 'true';

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (LOCAL_HOSTS.includes(hostname)) {
      return configured || `${protocol}//${hostname}:5000`;
    }

    if (forceDirectApi && configured) {
      return configured;
    }

    return '';
  }

  return configured || '';
};

export const buildApiUrl = (path = '') => {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  const apiOrigin = getApiOrigin();
  return apiOrigin ? `${apiOrigin}${normalizedPath}` : normalizedPath;
};