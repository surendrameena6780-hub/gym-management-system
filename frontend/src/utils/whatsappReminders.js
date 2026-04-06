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

export const previewWhatsAppReminders = async ({ token, memberIds, templateKey }) => {
  const response = await axios.post(
    '/api/notifications/reminders/preview',
    {
      member_ids: memberIds,
      ...(templateKey ? { template_key: templateKey } : {}),
    },
    { headers: { 'x-auth-token': token } }
  );

  return unwrapReminderPayload(response.data);
};

export const getReminderPreviewBlockReason = (payload) => {
  const data = unwrapReminderPayload(payload);
  const firstBlocked = Array.isArray(data.preview_items)
    ? data.preview_items.find((item) => item && item.eligible === false)
    : null;
  return String(firstBlocked?.reason || '').trim();
};

export const buildReminderPreviewDialog = (payload, options = {}) => {
  const {
    singleTitle = 'Send Reminder',
    multiTitle = 'Send Reminders',
    singleConfirmLabel = 'Send Reminder',
    multiConfirmLabelPrefix = 'Send',
  } = options;

  const data = unwrapReminderPayload(payload);
  const items = Array.isArray(data.preview_items) ? data.preview_items : [];
  const eligibleItems = items.filter((item) => item?.eligible);
  const blockedCount = items.length - eligibleItems.length;

  if (eligibleItems.length === 0) {
    return null;
  }

  if (eligibleItems.length === 1) {
    const item = eligibleItems[0];
    return {
      title: singleTitle,
      confirmLabel: singleConfirmLabel,
      message: [
        `Recipient: ${item.full_name}${item.phone ? ` (${item.phone})` : ''}`,
        item.template_title ? `Template: ${item.template_title}` : '',
        '',
        String(item.message || '').trim(),
        blockedCount > 0 ? `\n${blockedCount} selected member${blockedCount === 1 ? '' : 's'} will be skipped.` : '',
      ].filter(Boolean).join('\n'),
    };
  }

  const previewBlocks = eligibleItems.slice(0, 3).map((item, index) => [
    `${index + 1}. ${item.full_name}${item.phone ? ` (${item.phone})` : ''}`,
    item.template_title ? `Template: ${item.template_title}` : '',
    String(item.message || '').trim(),
  ].filter(Boolean).join('\n'));

  return {
    title: multiTitle,
    confirmLabel: `${multiConfirmLabelPrefix} ${eligibleItems.length} Reminders`,
    message: [
      `${eligibleItems.length} reminders will be queued.`,
      blockedCount > 0 ? `${blockedCount} selected member${blockedCount === 1 ? '' : 's'} will be skipped.` : '',
      '',
      'Preview:',
      '',
      previewBlocks.join('\n\n'),
      eligibleItems.length > 3 ? `\n+ ${eligibleItems.length - 3} more member${eligibleItems.length - 3 === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join('\n'),
  };
};

export const summarizeReminderResult = (payload, label = 'Reminder') => {
  const data = unwrapReminderPayload(payload);
  const sentCount = Number(data.sent_to_count || 0);
  const failedCount = Number(data.failed_count || 0);
  const firstFailure = String(data.failures?.[0]?.reason || '').trim();

  if (sentCount > 0 && failedCount > 0) {
    return {
      message: `${label}s queued for ${sentCount} members, ${failedCount} blocked or failed.`,
      tone: 'warning',
    };
  }

  if (sentCount > 0) {
    return {
      message: sentCount === 1 ? `${label} queued for WhatsApp delivery.` : `${label}s queued for ${sentCount} members.`,
      tone: 'success',
    };
  }

  return {
    message: firstFailure || `No ${label.toLowerCase()}s were sent.`,
    tone: 'error',
  };
};