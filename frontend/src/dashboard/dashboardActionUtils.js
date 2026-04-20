const asArray = (value) => (Array.isArray(value) ? value : []);

export const DASHBOARD_ACTION_SUPPRESSION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export const normalizeBroadcastTemplates = (sourceTemplates) => asArray(sourceTemplates)
  .map((template) => ({
    ...template,
    template_key: String(template?.template_key || '').trim().toUpperCase(),
  }))
  .filter((template) => Boolean(template.template_key))
  .filter((template) => template.is_active !== false)
  .filter((template) => String(template.whatsapp_template_status || '').toUpperCase() === 'APPROVED');

export const normalizeActionMembers = (sourceMembers) => {
  const uniqueMembers = new Map();

  asArray(sourceMembers).forEach((member) => {
    const id = Number.parseInt(member?.id, 10);
    if (!Number.isInteger(id) || uniqueMembers.has(id)) return;
    uniqueMembers.set(id, member);
  });

  return Array.from(uniqueMembers.values());
};

export const normalizeDashboardActionKey = (value) => String(value || '').trim().toUpperCase();

const hashDashboardMemberIds = (value) => {
  let hash = 2166136261;
  const source = String(value || '');

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

export const buildDashboardAudienceHash = (memberIds = []) => {
  const normalizedIds = asArray(memberIds)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);

  if (normalizedIds.length === 0) return '';

  return `${normalizedIds.length}:${hashDashboardMemberIds(normalizedIds.join('|'))}`;
};

export const buildBroadcastActionMeta = ({ actionKey, members: sourceMembers }) => {
  const normalizedActionKey = normalizeDashboardActionKey(actionKey);
  if (!normalizedActionKey) return null;

  const normalizedMembers = normalizeActionMembers(sourceMembers);
  const memberIds = normalizedMembers
    .map((member) => Number.parseInt(member?.id, 10))
    .filter((memberId) => Number.isInteger(memberId) && memberId > 0);

  if (memberIds.length === 0) return null;

  return {
    actionKey: normalizedActionKey,
    expectedCount: memberIds.length,
    audienceHash: buildDashboardAudienceHash(memberIds),
  };
};

export const isDashboardActionCompleted = (
  campaignLogs = [],
  actionMeta,
  suppressionWindowMs = DASHBOARD_ACTION_SUPPRESSION_WINDOW_MS,
) => {
  if (!actionMeta?.actionKey || !actionMeta?.audienceHash || Number(actionMeta?.expectedCount || 0) <= 0) {
    return false;
  }

  const cutoffTimestamp = Date.now() - suppressionWindowMs;

  return asArray(campaignLogs).some((log) => {
    const createdAt = new Date(log?.created_at || '').getTime();
    if (!Number.isFinite(createdAt) || createdAt < cutoffTimestamp) {
      return false;
    }

    if (normalizeDashboardActionKey(log?.dashboard_action_key) !== actionMeta.actionKey) {
      return false;
    }

    if (String(log?.dashboard_audience_hash || '') !== actionMeta.audienceHash) {
      return false;
    }

    const expectedCount = Number(log?.dashboard_expected_count || 0);
    const sentCount = Number(log?.sent_to_count || 0);
    return expectedCount > 0 && sentCount >= expectedCount && String(log?.status || '').toUpperCase() !== 'FAILED';
  });
};