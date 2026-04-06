import axios from 'axios';

const unwrapReminderPayload = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return unwrapReminderPayload(payload.data);
  }
  return payload && typeof payload === 'object' ? payload : {};
};

export const sendWhatsAppReminders = async ({ token, memberIds, templateKey }) => {
  const response = await axios.post(
    '/api/notifications/reminders/send',
    {
      member_ids: memberIds,
      ...(templateKey ? { template_key: templateKey } : {}),
    },
    { headers: { 'x-auth-token': token } }
  );

  return unwrapReminderPayload(response.data);
};

export const summarizeReminderResult = (payload, label = 'Reminder') => {
  const data = unwrapReminderPayload(payload);
  const sentCount = Number(data.sent_to_count || 0);
  const failedCount = Number(data.failed_count || 0);
  const firstFailure = String(data.failures?.[0]?.reason || '').trim();

  if (sentCount > 0 && failedCount > 0) {
    return {
      message: `${label}s sent to ${sentCount} members, ${failedCount} failed.`,
      tone: 'warning',
    };
  }

  if (sentCount > 0) {
    return {
      message: sentCount === 1 ? `${label} sent on WhatsApp.` : `${label}s sent to ${sentCount} members.`,
      tone: 'success',
    };
  }

  return {
    message: firstFailure || `No ${label.toLowerCase()}s were sent.`,
    tone: 'error',
  };
};