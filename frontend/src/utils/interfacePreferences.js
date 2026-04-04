const STORAGE_KEY = 'gymvault:ui-preferences';

const DEFAULT_INTERFACE_PREFERENCES = {
  reduce_motion: false,
  compact_mode: false,
  dark_mode: true,
};

export const normalizeInterfacePreferences = (value) => ({
  reduce_motion: Boolean(value?.reduce_motion ?? value?.interface_reduce_motion ?? DEFAULT_INTERFACE_PREFERENCES.reduce_motion),
  compact_mode: Boolean(value?.compact_mode ?? value?.interface_compact_mode ?? DEFAULT_INTERFACE_PREFERENCES.compact_mode),
  dark_mode: Boolean(value?.dark_mode ?? value?.interface_dark_mode ?? DEFAULT_INTERFACE_PREFERENCES.dark_mode),
});

export const applyInterfacePreferences = (value) => {
  const normalized = normalizeInterfacePreferences(value);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('gv-reduce-motion', normalized.reduce_motion);
    document.documentElement.classList.toggle('gv-compact-ui', normalized.compact_mode);
    document.documentElement.classList.toggle('gv-dark-mode', normalized.dark_mode);
  }
  return normalized;
};

export const loadInterfacePreferencesLocal = () => {
  if (typeof window === 'undefined') return normalizeInterfacePreferences({});
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeInterfacePreferences(JSON.parse(raw)) : normalizeInterfacePreferences({});
  } catch (_err) {
    return normalizeInterfacePreferences({});
  }
};

export const saveInterfacePreferencesLocal = (value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeInterfacePreferences(value)));
  } catch (_err) {
    // Ignore storage failures.
  }
};