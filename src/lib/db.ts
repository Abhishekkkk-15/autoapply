import Dexie, { type Table } from 'dexie';
import type {
  AppliedJobRecord,
  ExecutionLog,
  Platform,
  ApplicationStatus,
  UserProfile,
  AppSettings,
  GeneratedArtifacts,
} from './types';

export interface StoredContact {
  id?: number;
  name?: string;
  email?: string;
  recruiterProfileUrl?: string;
  company: string;
  jobTitle: string;
  platform: Platform;
  extractedAt: number;
}

export class AutoApplyDatabase extends Dexie {
  appliedJobs!: Table<AppliedJobRecord, number>;
  contacts!: Table<StoredContact, number>;
  logs!: Table<ExecutionLog, number>;

  constructor() {
    super('AutoApplyAIDatabase');

    this.version(1).stores({
      appliedJobs: '++id, platform, externalJobId, company, status, appliedAt, [platform+externalJobId]',
      contacts: '++id, email, company, platform, extractedAt',
      logs: '++id, timestamp, level',
    });
  }
}

export const db = new AutoApplyDatabase();

// --- Repository Methods for Dexie ---

export async function addAppliedJob(
  record: Omit<AppliedJobRecord, 'id'>
): Promise<number> {
  const existing = await isAlreadyApplied(record.platform, record.externalJobId);
  if (existing) {
    const found = await db.appliedJobs
      .where({ platform: record.platform, externalJobId: record.externalJobId })
      .first();
    if (found?.id) {
      await db.appliedJobs.update(found.id, {
        ...record,
        appliedAt: Date.now(),
      });
      return found.id;
    }
  }
  const id = await db.appliedJobs.add(record as AppliedJobRecord);

  // If contacts were extracted, store them in contacts table
  if (record.extractedContacts) {
    const { emails, recruiterName, recruiterProfileUrl } = record.extractedContacts;
    if (emails?.length || recruiterProfileUrl || recruiterName) {
      for (const email of emails || []) {
        await addContact({
          name: recruiterName,
          email,
          recruiterProfileUrl,
          company: record.company,
          jobTitle: record.title,
          platform: record.platform,
          extractedAt: Date.now(),
        });
      }
      if (!emails?.length && (recruiterProfileUrl || recruiterName)) {
        await addContact({
          name: recruiterName,
          recruiterProfileUrl,
          company: record.company,
          jobTitle: record.title,
          platform: record.platform,
          extractedAt: Date.now(),
        });
      }
    }
  }

  return id;
}

export async function updateJobStatus(
  id: number,
  status: ApplicationStatus,
  notes?: string
): Promise<void> {
  const updatePayload: Partial<AppliedJobRecord> = { status };
  if (notes !== undefined) updatePayload.notes = notes;
  await db.appliedJobs.update(id, updatePayload);
}

export async function updateJobArtifacts(
  platform: Platform,
  externalJobId: string,
  artifacts?: Partial<GeneratedArtifacts>,
  notes?: string,
  status?: ApplicationStatus
): Promise<boolean> {
  const found = await db.appliedJobs
    .where({ platform, externalJobId })
    .first();
  if (found?.id) {
    const updatePayload: Partial<AppliedJobRecord> = {};
    if (artifacts) {
      updatePayload.generatedArtifacts = {
        ...found.generatedArtifacts,
        ...artifacts,
      };
    }
    if (notes !== undefined) updatePayload.notes = notes;
    if (status !== undefined) updatePayload.status = status;
    await db.appliedJobs.update(found.id, updatePayload);
    return true;
  }
  return false;
}

export async function getAppliedJobs(limit = 200): Promise<AppliedJobRecord[]> {
  return await db.appliedJobs.orderBy('appliedAt').reverse().limit(limit).toArray();
}

export async function isAlreadyApplied(
  platform: Platform,
  externalJobId: string
): Promise<boolean> {
  if (!externalJobId) return false;
  const found = await db.appliedJobs
    .where({ platform, externalJobId })
    .first();
  if (!found) return false;
  return found.status === 'APPLIED' || found.status === 'PENDING_APPROVAL';
}

export async function addContact(contact: StoredContact): Promise<number> {
  if (contact.email) {
    const existing = await db.contacts.where('email').equals(contact.email).first();
    if (existing?.id) return existing.id;
  }
  return await db.contacts.add(contact);
}

export async function getContacts(): Promise<StoredContact[]> {
  return await db.contacts.orderBy('extractedAt').reverse().toArray();
}

export async function addLog(log: Omit<ExecutionLog, 'id'>): Promise<number> {
  // Keep logs table from growing indefinitely (max 1000)
  const count = await db.logs.count();
  if (count > 1000) {
    const oldest = await db.logs.orderBy('timestamp').limit(200).keys();
    await db.logs.bulkDelete(oldest as number[]);
  }
  return await db.logs.add(log as ExecutionLog);
}

export async function getRecentLogs(limit = 100): Promise<ExecutionLog[]> {
  return await db.logs.orderBy('timestamp').reverse().limit(limit).toArray();
}

export async function clearLogs(): Promise<void> {
  await db.logs.clear();
}

export async function exportJobsToCSV(): Promise<string> {
  const jobs = await db.appliedJobs.orderBy('appliedAt').reverse().toArray();
  const headers = [
    'ID',
    'Platform',
    'Job ID',
    'Title',
    'Company',
    'Location',
    'Status',
    'Applied Date',
    'Job URL',
    'Recruiter Name',
    'Recruiter Email',
    'Recruiter Profile',
    'Notes',
  ];

  const rows = jobs.map((j) => [
    j.id ?? '',
    j.platform,
    `"${(j.externalJobId || '').replace(/"/g, '""')}"`,
    `"${(j.title || '').replace(/"/g, '""')}"`,
    `"${(j.company || '').replace(/"/g, '""')}"`,
    `"${(j.location || '').replace(/"/g, '""')}"`,
    j.status,
    new Date(j.appliedAt).toISOString(),
    `"${(j.jobUrl || '').replace(/"/g, '""')}"`,
    `"${(j.extractedContacts?.recruiterName || '').replace(/"/g, '""')}"`,
    `"${(j.extractedContacts?.emails?.join('; ') || '').replace(/"/g, '""')}"`,
    `"${(j.extractedContacts?.recruiterProfileUrl || '').replace(/"/g, '""')}"`,
    `"${(j.notes || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// --- Re-export storage methods from storage.ts ---
export {
  DEFAULT_USER_PROFILE,
  DEFAULT_APP_SETTINGS,
  getUserProfile,
  saveUserProfile,
  getAppSettings,
  saveAppSettings,
  incrementDailyApplications,
} from './storage';
