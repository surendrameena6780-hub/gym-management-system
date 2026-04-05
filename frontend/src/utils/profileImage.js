import { getApiOrigin } from './apiUrl';

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