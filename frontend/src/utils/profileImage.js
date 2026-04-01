const getApiOrigin = () => {
  const configured = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}${port === '5173' ? ':5000' : port ? `:${port}` : ''}`;
    }
  }

  return '';
};

export const normalizeProfileImageUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;

  let normalizedPath = raw.replace(/\\/g, '/');
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.startsWith('uploads/')
      ? `/${normalizedPath}`
      : `/uploads/profiles/${normalizedPath}`;
  }

  if (!normalizedPath.startsWith('/uploads/')) {
    normalizedPath = normalizedPath.startsWith('/profiles/')
      ? `/uploads${normalizedPath}`
      : normalizedPath;
  }

  const apiOrigin = getApiOrigin();
  return apiOrigin ? `${apiOrigin}${normalizedPath}` : normalizedPath;
};

export const normalizeMembersWithProfileImage = (members) => (
  Array.isArray(members)
    ? members.map((member) => ({
        ...member,
        profile_pic: normalizeProfileImageUrl(member?.profile_pic),
      }))
    : []
);