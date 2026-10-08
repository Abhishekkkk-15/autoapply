export type Platform =
  | 'linkedin'
  | 'wellfound'
  | 'naukri'
  | 'indeed'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'universal';

export interface WorkAuthorization {
  usCitizen: boolean;
  requiresSponsorship: boolean;
  authorizedInTargetCountry: boolean;
}

export interface JobPreferences {
  targetRoles: string[];
  blacklistedCompanies: string[];
  remoteOnly: boolean;
  minSalary: number;
  maxDaysOld?: number; // Maximum age of job in days (default: 30 days / 1 month)
}

export interface CustomQuestionAnswer {
  questionPattern: string; // Regex or keywords
  answer: string;
}

export interface UserProfile {
  fullName: string;
  email: string;
  phone: string;
  currentLocation: string;
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  yearsOfExperience: number;
  noticePeriodDays: number;
  expectedSalaryNumeric: number;
  currency: string;
  workAuthorization: WorkAuthorization;
  resumeMarkdown: string;
  jobPreferences: JobPreferences;
  customAnswers?: CustomQuestionAnswer[];
}

export interface ExtractedContact {
  emails: string[];
  recruiterProfileUrl?: string;
  recruiterName?: string;
}

export interface GeneratedArtifacts {
  coverLetter?: string;
  pitchNote?: string;
  coldEmail?: string;
  linkedinConnectionNote?: string;
}

export type ApplicationStatus =
  | 'APPLIED'
  | 'FAILED'
  | 'SKIPPED'
  | 'MANUAL_EXTERNAL'
  | 'PENDING_APPROVAL';

export interface AppliedJobRecord {
  id?: number;
  platform: Platform;
  externalJobId: string;
  title: string;
  company: string;
  location: string;
  jobUrl: string;
  jobDescription: string;
  extractedContacts: ExtractedContact;
  generatedArtifacts: GeneratedArtifacts;
  status: ApplicationStatus;
  appliedAt: number; // Unix timestamp
  notes: string;
}

export interface ScrapedJob {
  platform: Platform;
  externalJobId: string;
  title: string;
  company: string;
  location: string;
  jobUrl: string;
  jobDescription: string;
  extractedContacts: ExtractedContact;
  canEasyApply: boolean;
  postedDate?: string;
}

export type ApplyStepStatus =
  | 'SUCCESS'
  | 'STEP_ADVANCED'
  | 'PENDING_APPROVAL'
  | 'SUBMITTED'
  | 'FAILED'
  | 'SKIPPED'
  | 'MANUAL_EXTERNAL'
  | 'NO_EASY_APPLY';

export interface ApplyStepResult {
  status: ApplyStepStatus;
  message: string;
  stepName?: string;
  needsUserApproval?: boolean;
  error?: string;
  artifacts?: GeneratedArtifacts;
}

export type LLMProvider = 'openai' | 'claude' | 'groq' | 'ollama' | 'mcp' | 'custom' | 'azure';

export interface McpBridgeStatus {
  connected: boolean;
  port: number;
  lastPing?: number;
  activeClients: number;
}

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  mcpBridgePort?: number;
}

export interface AppSettings {
  mode: 'semi-auto' | 'full-auto';
  dailyApplicationCap: number;
  applicationsToday: number;
  lastApplicationDate: string; // YYYY-MM-DD
  minDelaySeconds: number;
  maxDelaySeconds: number;
  autoSubmit: boolean;
  llmConfig: LLMConfig;
}

export interface ExecutionLog {
  id?: number;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string;
}

export type AutomationEngineStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'WAITING_APPROVAL'
  | 'ERROR';

export interface SearchAndApplyParams {
  query: string;
  location?: string;
  platform?: Platform;
  mode?: 'semi-auto' | 'full-auto';
  maxJobs?: number;
  remoteOnly?: boolean;
}

export interface AutomationState {
  status: AutomationEngineStatus;
  mode: 'semi-auto' | 'full-auto';
  currentJob?: ScrapedJob;
  currentStepMessage?: string;
  processedCount: number;
  dailyCount: number;
  dailyCap: number;
  lastError?: string;
  searchParams?: SearchAndApplyParams;
  searchProgress?: {
    currentCardIndex: number;
    totalCardsFound: number;
    currentPage: number;
    totalApplied: number;
    maxJobs: number;
  };
}

// Background <-> Content / SidePanel Message Protocol
export type ExtensionMessage =
  | { type: 'START_QUEUE'; payload?: { mode?: 'semi-auto' | 'full-auto' } }
  | { type: 'PAUSE_QUEUE' }
  | { type: 'RESUME_QUEUE' }
  | { type: 'STOP_QUEUE' }
  | { type: 'START_SEARCH_AND_APPLY'; payload: SearchAndApplyParams }
  | {
      type: 'EXECUTE_APPLY_ON_CURRENT_TAB';
      payload?: {
        mode?: 'semi-auto' | 'full-auto';
        customPitch?: string;
        customCoverLetter?: string;
        customAnswers?: CustomQuestionAnswer[];
      };
    }
  | { type: 'SUBMIT_PENDING_APPROVAL' }
  | { type: 'CANCEL_PENDING_APPROVAL' }
  | { type: 'GET_STATE' }
  | { type: 'STATE_UPDATE'; payload: AutomationState }
  | { type: 'LOG_EVENT'; payload: ExecutionLog }
  | { type: 'STORE_APPLIED_JOB'; payload: AppliedJobRecord }
  | {
      type: 'SAVE_JOB_ARTIFACTS';
      payload: {
        platform: Platform;
        externalJobId: string;
        artifacts?: Partial<GeneratedArtifacts>;
        notes?: string;
        status?: ApplicationStatus;
      };
    }
  | { type: 'CONTENT_PARSED_JOB'; payload: ScrapedJob }
  | { type: 'CONTENT_STEP_RESULT'; payload: ApplyStepResult }
  | { type: 'CHECK_TAB_PLATFORM' }
  | { type: 'GET_SEARCH_RESULTS_INFO' }
  | { type: 'SELECT_SEARCH_RESULT_CARD'; payload: { index: number } }
  | { type: 'PAGINATE_NEXT_PAGE' }
  | { type: 'GET_MCP_STATUS' }
  | { type: 'RECONNECT_MCP' }
  | { type: 'MCP_STATUS_UPDATE'; payload: McpBridgeStatus }
  | {
      type: 'GMAIL_COMPOSE_AND_SEND';
      payload: { to: string; subject: string; body: string; action?: 'draft' | 'send' };
    }
  | {
      type: 'LINKEDIN_SEND_OUTREACH';
      payload: { profileUrl?: string; note: string; action?: 'connect' | 'message' };
    }
  | {
      type: 'SCRAPE_CURRENT_PAGE';
      payload?: { extractJobDetails?: boolean };
    }
  | {
      type: 'NAVIGATE_TAB';
      payload: { url: string; newTab?: boolean; waitForSelector?: string };
    }
  | {
      type: 'SET_AUTOMATION_MODE';
      payload: { mode: 'conservative' | 'standard' | 'aggressive'; dailyCap?: number };
    };
