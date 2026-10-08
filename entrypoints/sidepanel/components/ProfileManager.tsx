import React, { useState, useEffect } from 'react';
import {
  Save,
  RotateCcw,
  Plus,
  Trash2,
  FileText,
  User,
  DollarSign,
  ShieldCheck,
  CheckCircle2,
  Briefcase,
  X,
} from 'lucide-react';
import type { UserProfile, CustomQuestionAnswer } from '@/src/lib/types';
import { getUserProfile, saveUserProfile, DEFAULT_USER_PROFILE } from '@/src/lib/db';

export const ProfileManager: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [newRoleInput, setNewRoleInput] = useState('');
  const [newCompanyInput, setNewCompanyInput] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [activeSection, setActiveSection] = useState<
    'contact' | 'work' | 'roles' | 'resume' | 'qa'
  >('contact');

  useEffect(() => {
    getUserProfile().then((data) => setProfile(data));
  }, []);

  const handleSave = async () => {
    await saveUserProfile(profile);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleResetToDefault = async () => {
    if (confirm('Clear profile fields?')) {
      setProfile(DEFAULT_USER_PROFILE);
      await saveUserProfile(DEFAULT_USER_PROFILE);
    }
  };

  // Target Roles Tag Management
  const addTargetRole = () => {
    if (!newRoleInput.trim()) return;
    const current = profile.jobPreferences?.targetRoles || [];
    if (!current.includes(newRoleInput.trim())) {
      setProfile({
        ...profile,
        jobPreferences: {
          ...profile.jobPreferences,
          targetRoles: [...current, newRoleInput.trim()],
        },
      });
    }
    setNewRoleInput('');
  };

  const removeTargetRole = (role: string) => {
    setProfile({
      ...profile,
      jobPreferences: {
        ...profile.jobPreferences,
        targetRoles: profile.jobPreferences.targetRoles.filter((r) => r !== role),
      },
    });
  };

  // Blacklist Management
  const addBlacklistedCompany = () => {
    if (!newCompanyInput.trim()) return;
    const current = profile.jobPreferences?.blacklistedCompanies || [];
    if (!current.includes(newCompanyInput.trim())) {
      setProfile({
        ...profile,
        jobPreferences: {
          ...profile.jobPreferences,
          blacklistedCompanies: [...current, newCompanyInput.trim()],
        },
      });
    }
    setNewCompanyInput('');
  };

  const removeBlacklistedCompany = (comp: string) => {
    setProfile({
      ...profile,
      jobPreferences: {
        ...profile.jobPreferences,
        blacklistedCompanies: profile.jobPreferences.blacklistedCompanies.filter(
          (c) => c !== comp
        ),
      },
    });
  };

  // Custom Q&A Management
  const addCustomQA = () => {
    if (!newPattern.trim() || !newAnswer.trim()) return;
    const current = profile.customAnswers || [];
    setProfile({
      ...profile,
      customAnswers: [
        ...current,
        { questionPattern: newPattern.trim(), answer: newAnswer.trim() },
      ],
    });
    setNewPattern('');
    setNewAnswer('');
  };

  const removeCustomQA = (index: number) => {
    const current = [...(profile.customAnswers || [])];
    current.splice(index, 1);
    setProfile({ ...profile, customAnswers: current });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Action Header */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm sticky top-0 z-10">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Profile & Experience</h2>
          <p className="text-[11px] text-slate-500">Autonomous application profile</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetToDefault}
            title="Reset to sample"
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition active:scale-95"
          >
            {savedSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex bg-slate-200/80 p-1 rounded-lg text-xs font-semibold text-slate-600">
        <button
          onClick={() => setActiveSection('contact')}
          className={`flex-1 py-1.5 rounded-md transition ${
            activeSection === 'contact' ? 'bg-white text-blue-700 shadow-sm' : ''
          }`}
        >
          Contact
        </button>
        <button
          onClick={() => setActiveSection('work')}
          className={`flex-1 py-1.5 rounded-md transition ${
            activeSection === 'work' ? 'bg-white text-blue-700 shadow-sm' : ''
          }`}
        >
          Auth & Comp
        </button>
        <button
          onClick={() => setActiveSection('roles')}
          className={`flex-1 py-1.5 rounded-md transition ${
            activeSection === 'roles' ? 'bg-white text-blue-700 shadow-sm' : ''
          }`}
        >
          Roles
        </button>
        <button
          onClick={() => setActiveSection('resume')}
          className={`flex-1 py-1.5 rounded-md transition ${
            activeSection === 'resume' ? 'bg-white text-blue-700 shadow-sm' : ''
          }`}
        >
          Resume
        </button>
        <button
          onClick={() => setActiveSection('qa')}
          className={`flex-1 py-1.5 rounded-md transition ${
            activeSection === 'qa' ? 'bg-white text-blue-700 shadow-sm' : ''
          }`}
        >
          Q&A
        </button>
      </div>

      {/* 1. Contact & Social Information */}
      {activeSection === 'contact' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
            <User className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Personal Information
            </h3>
          </div>

          <div className="space-y-2.5 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Full Name</label>
              <input
                type="text"
                value={profile.fullName}
                onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Full Name"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Phone</label>
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Location</label>
              <input
                type="text"
                value={profile.currentLocation}
                onChange={(e) => setProfile({ ...profile, currentLocation: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="City, State / Country"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Portfolio Website</label>
              <input
                type="url"
                value={profile.portfolioUrl}
                onChange={(e) => setProfile({ ...profile, portfolioUrl: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">LinkedIn Profile</label>
              <input
                type="url"
                value={profile.linkedinUrl}
                onChange={(e) => setProfile({ ...profile, linkedinUrl: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">GitHub Profile</label>
              <input
                type="url"
                value={profile.githubUrl}
                onChange={(e) => setProfile({ ...profile, githubUrl: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* 2. Work Authorization & Compensation */}
      {activeSection === 'work' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-4 text-xs">
          {/* Work Authorization */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Work Authorization
              </h3>
            </div>

            <label className="flex items-center gap-2.5 p-2 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={profile.workAuthorization.usCitizen}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    workAuthorization: {
                      ...profile.workAuthorization,
                      usCitizen: e.target.checked,
                    },
                  })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium text-slate-700">Citizen of Target Country / US</span>
            </label>

            <label className="flex items-center gap-2.5 p-2 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={profile.workAuthorization.authorizedInTargetCountry}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    workAuthorization: {
                      ...profile.workAuthorization,
                      authorizedInTargetCountry: e.target.checked,
                    },
                  })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium text-slate-700">Legally Authorized to Work</span>
            </label>

            <label className="flex items-center gap-2.5 p-2 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={profile.workAuthorization.requiresSponsorship}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    workAuthorization: {
                      ...profile.workAuthorization,
                      requiresSponsorship: e.target.checked,
                    },
                  })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium text-slate-700">Requires Visa Sponsorship</span>
            </label>
          </div>

          {/* Compensation & Experience */}
          <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Experience & Compensation
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-600 font-medium mb-1">
                  Years of Experience
                </label>
                <input
                  type="number"
                  min="0"
                  max="40"
                  value={profile.yearsOfExperience}
                  onChange={(e) =>
                    setProfile({ ...profile, yearsOfExperience: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">
                  Notice Period (Days)
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={profile.noticePeriodDays}
                  onChange={(e) =>
                    setProfile({ ...profile, noticePeriodDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-slate-600 font-medium mb-1">
                  Expected Annual Salary
                </label>
                <input
                  type="number"
                  value={profile.expectedSalaryNumeric}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      expectedSalaryNumeric: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Currency</label>
                <input
                  type="text"
                  value={profile.currency}
                  onChange={(e) => setProfile({ ...profile, currency: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500 uppercase"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Target Roles & Whitelist/Blacklist */}
      {activeSection === 'roles' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-4 text-xs">
          {/* Target Roles */}
          <div className="flex flex-col gap-2">
            <label className="font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <Briefcase className="w-4 h-4 text-blue-600" />
              Target Job Roles (Whitelist)
            </label>
            <p className="text-[11px] text-slate-500">
              Auto-applies only to jobs matching these role titles:
            </p>

            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-slate-50 rounded-lg border border-slate-200">
              {profile.jobPreferences.targetRoles.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-[11px] font-semibold"
                >
                  {role}
                  <button
                    onClick={() => removeTargetRole(role)}
                    className="hover:text-blue-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Senior Frontend Engineer"
                value={newRoleInput}
                onChange={(e) => setNewRoleInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTargetRole()}
                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
              />
              <button
                onClick={addTargetRole}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold"
              >
                Add
              </button>
            </div>
          </div>

          {/* Blacklisted Companies */}
          <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
            <label className="font-bold text-rose-800 uppercase tracking-wide flex items-center gap-1.5">
              <Trash2 className="w-4 h-4 text-rose-600" />
              Blacklisted Companies
            </label>
            <p className="text-[11px] text-slate-500">
              Instantly skips applications for these companies:
            </p>

            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-rose-50/50 rounded-lg border border-rose-200">
              {profile.jobPreferences.blacklistedCompanies.map((comp) => (
                <span
                  key={comp}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-100 text-rose-800 rounded-full text-[11px] font-semibold"
                >
                  {comp}
                  <button
                    onClick={() => removeBlacklistedCompany(comp)}
                    className="hover:text-rose-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Company name to block"
                value={newCompanyInput}
                onChange={(e) => setNewCompanyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addBlacklistedCompany()}
                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
              />
              <button
                onClick={addBlacklistedCompany}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold"
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Resume Markdown */}
      {activeSection === 'resume' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-2.5 text-xs">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Resume Markdown Context
              </h3>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            The AI reads this raw text when crafting customized cover letters, answering
            experience questions, and pitching hiring managers.
          </p>

          <textarea
            rows={14}
            value={profile.resumeMarkdown}
            onChange={(e) => setProfile({ ...profile, resumeMarkdown: e.target.value })}
            className="w-full p-3 font-mono text-[11px] border border-slate-300 rounded-lg text-slate-900 leading-relaxed focus:ring-2 focus:ring-blue-500"
            placeholder="Paste your markdown resume, skills, and work experience here..."
          />
        </div>
      )}

      {/* 5. Custom Q&A Rules */}
      {activeSection === 'qa' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-3 text-xs">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Custom Question & Answer Rules
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Define deterministic answers for recurring application questions.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {(profile.customAnswers || []).map((qa, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
              >
                <div className="flex-1 pr-2">
                  <span className="font-semibold text-slate-700 block">
                    Pattern: "{qa.questionPattern}"
                  </span>
                  <span className="text-blue-700 text-[11px] font-mono">
                    Answer: {qa.answer}
                  </span>
                </div>
                <button
                  onClick={() => removeCustomQA(idx)}
                  className="text-slate-400 hover:text-rose-600 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-col gap-2 mt-1">
            <span className="font-bold text-slate-700 text-[11px]">Add New Custom Rule</span>
            <input
              type="text"
              placeholder="Question pattern (e.g. visa sponsorship, relocate)"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-md text-slate-900"
            />
            <input
              type="text"
              placeholder="Preset Answer (e.g. No, Yes, 100%)"
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-md text-slate-900"
            />
            <button
              onClick={addCustomQA}
              className="self-end px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-bold text-xs"
            >
              Add Rule
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
