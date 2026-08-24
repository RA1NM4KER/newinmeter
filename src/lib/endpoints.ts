const apiBase = "/api";

export const apiEndpoints = {
  adminUsers: `${apiBase}/admin/users`,
  adminFeatures: `${apiBase}/admin/features`,
  activities: `${apiBase}/activities`,
  activityReport: `${apiBase}/activity-report`,
  activityExport: `${apiBase}/activity-export`,
  assistant: `${apiBase}/assistant`,
  assistantActions: `${apiBase}/assistant/actions`,
  dailyRollups: `${apiBase}/daily-rollups`,
  dayIntervals: `${apiBase}/day-intervals`,
  energyRows: `${apiBase}/energy-rows`,
  export: `${apiBase}/export`,
  liveOverview: `${apiBase}/live/overview`,
  sync: `${apiBase}/sync`
} as const;

export function buildLiveOverviewUrl(window: string) {
  return `${apiEndpoints.liveOverview}?window=${encodeURIComponent(window)}`;
}

export function buildDayIntervalsUrl(periodDate: string) {
  return `${apiEndpoints.dayIntervals}?periodDate=${encodeURIComponent(periodDate)}`;
}

export function buildDailyRollupsUrl(range: { from?: string; to?: string } = {}) {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  return params.size ? `${apiEndpoints.dailyRollups}?${params.toString()}` : apiEndpoints.dailyRollups;
}

export function buildEnergyRowsUrl(params: URLSearchParams) {
  return `${apiEndpoints.energyRows}?${params.toString()}`;
}

export function buildActivitiesUrl(params?: URLSearchParams) {
  return params?.size ? `${apiEndpoints.activities}?${params.toString()}` : apiEndpoints.activities;
}

export function buildActivityReportUrl(params: URLSearchParams) {
  return `${apiEndpoints.activityReport}?${params.toString()}`;
}

export function buildExportUrl(params: URLSearchParams) {
  return `${apiEndpoints.export}?${params.toString()}`;
}

export function buildAdminUserRoleUrl(userId: string) {
  return `${apiEndpoints.adminUsers}/${userId}/role`;
}

export function buildAdminUserPermissionsUrl(userId: string) {
  return `${apiEndpoints.adminUsers}/${userId}/permissions`;
}

export function buildAdminFeatureUrl(featureKey: string) {
  return `${apiEndpoints.adminFeatures}/${featureKey}`;
}

export function buildAdminFeatureUsersUrl(featureKey: string) {
  return `${apiEndpoints.adminFeatures}/${featureKey}/users`;
}
