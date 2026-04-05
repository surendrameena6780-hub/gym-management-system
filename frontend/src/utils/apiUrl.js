const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const DEFAULT_PRODUCTION_API_ORIGIN = 'https://gym-management-system-4nfu.onrender.com';

export const getApiOrigin = () => {
  const configured = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (LOCAL_HOSTS.includes(hostname)) {
      return `${protocol}//${hostname}:5000`;
    }

    return DEFAULT_PRODUCTION_API_ORIGIN;
  }

  return '';
};

export const buildApiUrl = (path = '') => {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  const apiOrigin = getApiOrigin();
  return apiOrigin ? `${apiOrigin}${normalizedPath}` : normalizedPath;
};