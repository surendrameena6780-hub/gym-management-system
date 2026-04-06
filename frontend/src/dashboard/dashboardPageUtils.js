import { normalizeProfileImageUrl } from '../utils/profileImage';

export const buildProfileUrl = (pic) => normalizeProfileImageUrl(pic);

export const resolveBroadcastTemplateSuggestion = (audience) => ({
  All: 'SALES_OFFER',
  Active: 'SALES_OFFER',
  Expiring: 'RENEWAL_REMINDER',
  Expired: 'EXPIRED',
  Ghosts: 'INACTIVE',
  HighChurn: 'INACTIVE',
}[audience] || 'SALES_OFFER');

export const normalizePhoneInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

export const isValidPhoneInput = (value) => /^\d{10}$/.test(normalizePhoneInput(value));

export const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};

export const formatHour = (hour) => {
  if (hour === 0) return '12A';
  if (hour < 12) return `${hour}A`;
  if (hour === 12) return '12P';
  return `${hour - 12}P`;
};

export const getPriorityMeta = (priority) => {
  if (priority === 'P0') {
    return {
      label: 'Critical',
      badgeClass: 'bg-rose-50 text-rose-700 border border-rose-100',
      rowClass: 'border-rose-100 bg-white',
      buttonClass: 'bg-rose-600 text-white hover:bg-rose-700',
    };
  }
  if (priority === 'P1') {
    return {
      label: 'Attention',
      badgeClass: 'bg-amber-50 text-amber-700 border border-amber-100',
      rowClass: 'border-amber-100 bg-white',
      buttonClass: 'bg-amber-500 text-white hover:bg-amber-600',
    };
  }
  return {
    label: 'Opportunity',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-100',
    rowClass: 'border-slate-200 bg-white',
    buttonClass: 'bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50',
  };
};