import React, { useState, useEffect } from 'react';
import {
  Download,
  Search,
  ExternalLink,
  Mail,
  UserCheck,
  FileText,
  Copy,
  Check,
  X,
  Building,
  MapPin,
  Calendar,
  Filter,
  Users,
} from 'lucide-react';
import type { AppliedJobRecord, Platform, ApplicationStatus } from '@/src/lib/types';
import { getAppliedJobs, exportJobsToCSV, getContacts, type StoredContact } from '@/src/lib/db';

export const JobTrackerTable: React.FC = () => {
  const [jobs, setJobs] = useState<AppliedJobRecord[]>([]);
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [activeTab, setActiveTab] = useState<'jobs' | 'contacts'>('jobs');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedJobModal, setSelectedJobModal] = useState<AppliedJobRecord | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [outreachStatus, setOutreachStatus] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const j = await getAppliedJobs(300);
    const c = await getContacts();
    setJobs(j);
    setContacts(c);
  };

  const handleExportCSV = async () => {
    const csvContent = await exportJobsToCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `autoapply-jobs-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSendViaGmail = (job: AppliedJobRecord) => {
    const to = job.extractedContacts?.emails?.[0] || 'hiring@company.com';
    const subject = `${job.title} application inquiry`;
    const body = job.generatedArtifacts?.coldEmail || '';
    setOutreachStatus('Opening Gmail...');
    chrome.runtime.sendMessage(
      {
        type: 'GMAIL_COMPOSE_AND_SEND',
        payload: { to, subject, body, action: 'draft' },
      },
      (res) => {
        setOutreachStatus(res?.message || 'Gmail draft opened!');
        setTimeout(() => setOutreachStatus(null), 4000);
      }
    );
  };

  const handleConnectLinkedIn = (job: AppliedJobRecord) => {
    const profileUrl = job.extractedContacts?.recruiterProfileUrl;
    const note = job.generatedArtifacts?.linkedinConnectionNote || '';
    setOutreachStatus('Connecting on LinkedIn...');
    chrome.runtime.sendMessage(
      {
        type: 'LINKEDIN_SEND_OUTREACH',
        payload: { profileUrl, note, action: 'connect' },
      },
      (res) => {
        setOutreachStatus(res?.message || 'LinkedIn outreach completed!');
        setTimeout(() => setOutreachStatus(null), 4000);
      }
    );
  };

  // Filtered jobs
  const filteredJobs = jobs.filter((job) => {
    const matchesSearch =
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.location.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPlatform =
      selectedPlatform === 'all' || job.platform === selectedPlatform;
    const matchesStatus =
      selectedStatus === 'all' || job.status === selectedStatus;

    return matchesSearch && matchesPlatform && matchesStatus;
  });

  const getStatusBadge = (status: ApplicationStatus) => {
    switch (status) {
      case 'APPLIED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
            APPLIED
          </span>
        );
      case 'PENDING_APPROVAL':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
            PENDING
          </span>
        );
      case 'MANUAL_EXTERNAL':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
            EXTERNAL
          </span>
        );
      case 'SKIPPED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
            SKIPPED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* Header Actions */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          <button
            onClick={() => setActiveTab('jobs')}
            className={`px-3 py-1.5 rounded-md font-bold transition ${
              activeTab === 'jobs' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Applications ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('contacts')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-md font-bold transition ${
              activeTab === 'contacts' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Recruiters ({contacts.length})
          </button>
        </div>

        <button
          onClick={handleExportCSV}
          title="Export CSV"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold text-xs shadow-sm transition"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
      </div>

      {/* Search and Filters */}
      {activeTab === 'jobs' && (
        <>
          <div className="flex flex-col gap-2 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by role, company, or city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2">
              <select
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 bg-white"
              >
                <option value="all">All Platforms</option>
                <option value="linkedin">LinkedIn</option>
                <option value="wellfound">Wellfound</option>
                <option value="naukri">Naukri</option>
                <option value="indeed">Indeed</option>
              </select>

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="APPLIED">Applied</option>
                <option value="PENDING_APPROVAL">Pending</option>
                <option value="MANUAL_EXTERNAL">Manual External</option>
                <option value="SKIPPED">Skipped</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>

          {/* Jobs List */}
          <div className="flex flex-col gap-2">
            {filteredJobs.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500">
                <FileText className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-semibold text-slate-700">No applications found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Start an auto-apply session to track applications here.
                </p>
              </div>
            ) : (
              filteredJobs.map((job) => (
                <div
                  key={job.id}
                  className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-2 hover:border-slate-300 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <h4 className="font-bold text-slate-900 text-sm leading-snug line-clamp-1">
                        {job.title}
                      </h4>
                      <div className="flex items-center gap-2 text-slate-600 mt-0.5 text-[11px]">
                        <span className="font-semibold flex items-center gap-1">
                          <Building className="w-3 h-3 text-slate-400" />
                          {job.company}
                        </span>
                        <span>•</span>
                        <span className="text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {job.location}
                        </span>
                      </div>
                    </div>
                    {getStatusBadge(job.status)}
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-100 text-slate-500">
                    <div className="flex items-center gap-2">
                      <span className="uppercase font-extrabold text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                        {job.platform}
                      </span>
                      <span>
                        {new Date(job.appliedAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {job.jobUrl && (
                        <a
                          href={job.jobUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-400 hover:text-blue-600"
                          title="Open original job posting"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => setSelectedJobModal(job)}
                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-md text-[11px] transition"
                      >
                        Artifacts
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Recruiter Contacts Tab */}
      {activeTab === 'contacts' && (
        <div className="flex flex-col gap-2">
          {contacts.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500">
              <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-slate-700">No recruiter contacts captured</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Emails and recruiter LinkedIn profiles parsed from job descriptions will appear here.
              </p>
            </div>
          ) : (
            contacts.map((c) => (
              <div
                key={c.id}
                className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">
                      {c.name || 'Hiring Team Member'}
                    </h4>
                    <p className="text-slate-600 text-[11px] mt-0.5">
                      {c.company} • {c.jobTitle}
                    </p>
                  </div>
                  <span className="uppercase font-bold text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                    {c.platform}
                  </span>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-100 text-[11px]">
                  {c.email && (
                    <div className="flex items-center justify-between text-blue-700">
                      <span className="flex items-center gap-1.5">
                        <Mail className="w-3 h-3" />
                        {c.email}
                      </span>
                      <button
                        onClick={() => copyToClipboard(c.email!, `contact-${c.id}`)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        {copiedKey === `contact-${c.id}` ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  )}

                  {c.recruiterProfileUrl && (
                    <a
                      href={c.recruiterProfileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3 h-3" />
                      View LinkedIn Profile <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Artifacts Modal Drawer */}
      {selectedJobModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-4">
          <div className="bg-white w-full max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/80">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Generated Application Artifacts
                </h3>
                <p className="text-[11px] text-slate-500">
                  {selectedJobModal.title} at {selectedJobModal.company}
                </p>
              </div>
              <button
                onClick={() => setSelectedJobModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-4 overflow-y-auto space-y-4">
              {outreachStatus && (
                <div className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 animate-pulse text-blue-600" />
                  <span>{outreachStatus}</span>
                </div>
              )}

              {/* 1. Tailored Cover Letter */}
              {selectedJobModal.generatedArtifacts?.coverLetter && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                      3-Paragraph Cover Letter
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          selectedJobModal.generatedArtifacts.coverLetter!,
                          'letter'
                        )
                      }
                      className="flex items-center gap-1 text-[11px] text-blue-600 font-semibold hover:text-blue-700"
                    >
                      {copiedKey === 'letter' ? (
                        <>
                          <Check className="w-3 h-3" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 font-serif whitespace-pre-wrap leading-relaxed text-[11px]">
                    {selectedJobModal.generatedArtifacts.coverLetter}
                  </div>
                </div>
              )}

              {/* 2. 150-Word Pitch Note */}
              {selectedJobModal.generatedArtifacts?.pitchNote && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                      Wellfound / Quick Pitch Note (~150 words)
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          selectedJobModal.generatedArtifacts.pitchNote!,
                          'pitch'
                        )
                      }
                      className="flex items-center gap-1 text-[11px] text-blue-600 font-semibold hover:text-blue-700"
                    >
                      {copiedKey === 'pitch' ? (
                        <>
                          <Check className="w-3 h-3" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 whitespace-pre-wrap leading-relaxed text-[11px]">
                    {selectedJobModal.generatedArtifacts.pitchNote}
                  </div>
                </div>
              )}

              {/* 3. Cold Email Outreach */}
              {selectedJobModal.generatedArtifacts?.coldEmail && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                      Executive Cold Email Outreach
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSendViaGmail(selectedJobModal)}
                        className="flex items-center gap-1 text-[11px] bg-red-50 text-red-700 px-2 py-0.5 rounded border border-red-200 font-semibold hover:bg-red-100 transition-colors"
                        title="Open and populate Gmail compose draft"
                      >
                        <Mail className="w-3 h-3 text-red-600" /> Open in Gmail
                      </button>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            selectedJobModal.generatedArtifacts.coldEmail!,
                            'cold'
                          )
                        }
                        className="flex items-center gap-1 text-[11px] text-blue-600 font-semibold hover:text-blue-700"
                      >
                        {copiedKey === 'cold' ? (
                          <>
                            <Check className="w-3 h-3" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 whitespace-pre-wrap leading-relaxed text-[11px]">
                    {selectedJobModal.generatedArtifacts.coldEmail}
                  </div>
                </div>
              )}

              {/* 4. LinkedIn Connection Request Note */}
              {selectedJobModal.generatedArtifacts?.linkedinConnectionNote && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                      LinkedIn Connection Note (&lt;300 chars)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleConnectLinkedIn(selectedJobModal)}
                        className="flex items-center gap-1 text-[11px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded border border-sky-200 font-semibold hover:bg-sky-100 transition-colors"
                        title="Open profile and send connection note"
                      >
                        <UserCheck className="w-3 h-3 text-sky-600" /> Connect on LinkedIn
                      </button>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            selectedJobModal.generatedArtifacts.linkedinConnectionNote!,
                            'linote'
                          )
                        }
                        className="flex items-center gap-1 text-[11px] text-blue-600 font-semibold hover:text-blue-700"
                      >
                        {copiedKey === 'linote' ? (
                          <>
                            <Check className="w-3 h-3" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 text-[11px]">
                    {selectedJobModal.generatedArtifacts.linkedinConnectionNote}
                  </div>
                  <span className="text-[10px] text-slate-400 text-right">
                    Length:{' '}
                    {selectedJobModal.generatedArtifacts.linkedinConnectionNote.length} / 300 chars
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
