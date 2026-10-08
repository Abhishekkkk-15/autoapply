import type { UserProfile, AppSettings } from './types';

export const DEFAULT_USER_PROFILE: UserProfile = {
  fullName: '',
  email: '',
  phone: '',
  currentLocation: '',
  portfolioUrl: '',
  linkedinUrl: '',
  githubUrl: '',
  yearsOfExperience: 0,
  noticePeriodDays: 0,
  expectedSalaryNumeric: 0,
  currency: 'USD',
  workAuthorization: {
    usCitizen: false,
    requiresSponsorship: false,
    authorizedInTargetCountry: true,
  },
  resumeMarkdown: '',
  jobPreferences: {
    targetRoles: [],
    blacklistedCompanies: [],
    remoteOnly: false,
    minSalary: 0,
    maxDaysOld: 30,
  },
  customAnswers: [],
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  mode: 'semi-auto',
  dailyApplicationCap: 30,
  applicationsToday: 0,
  lastApplicationDate: new Date().toISOString().split('T')[0],
  minDelaySeconds: 4,
  maxDelaySeconds: 9,
  autoSubmit: false,
  llmConfig: {
    provider: 'mcp',
    apiKey: '',
    baseUrl: 'ws://127.0.0.1:8765',
    model: 'coding-agent-mcp',
    temperature: 0.2,
    mcpBridgePort: 8765,
  },
};

const STORAGE_KEYS = {
  USER_PROFILE: 'autoapply_user_profile',
  APP_SETTINGS: 'autoapply_app_settings',
};

export async function getUserProfile(): Promise<UserProfile> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.USER_PROFILE);
    if (data && data[STORAGE_KEYS.USER_PROFILE]) {
      return { ...DEFAULT_USER_PROFILE, ...data[STORAGE_KEYS.USER_PROFILE] };
    }
  } catch (err) {
    console.warn('Failed to read user profile from storage:', err);
  }
  return DEFAULT_USER_PROFILE;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: profile });
}

export async function getAppSettings(): Promise<AppSettings> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.APP_SETTINGS);
    if (data && data[STORAGE_KEYS.APP_SETTINGS]) {
      const settings = { ...DEFAULT_APP_SETTINGS, ...data[STORAGE_KEYS.APP_SETTINGS] };
      // Reset daily counter if day changed
      if (settings.lastApplicationDate !== today) {
        settings.lastApplicationDate = today;
        settings.applicationsToday = 0;
        await chrome.storage.local.set({ [STORAGE_KEYS.APP_SETTINGS]: settings });
      }
      return settings;
    }
  } catch (err) {
    console.warn('Failed to read app settings from storage:', err);
  }
  return DEFAULT_APP_SETTINGS;
}

export async function saveAppSettings(
  settings: Partial<AppSettings>
): Promise<AppSettings> {
  const current = await getAppSettings();
  const merged: AppSettings = {
    ...current,
    ...settings,
    llmConfig: {
      ...current.llmConfig,
      ...(settings.llmConfig || {}),
    },
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.APP_SETTINGS]: merged });
  return merged;
}

export async function incrementDailyApplications(): Promise<number> {
  const settings = await getAppSettings();
  settings.applicationsToday += 1;
  await saveAppSettings(settings);
  return settings.applicationsToday;
}
