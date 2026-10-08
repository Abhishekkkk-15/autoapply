import { extractText } from 'unpdf';
import { extractEmails } from './extractor';
import type { UserProfile, LLMConfig } from './types';
import { callLLMJson } from './ai';
import { getAppSettings } from './storage';

export interface ExtractedResumeDetails {
  fullName: string;
  email: string;
  phone: string;
  currentLocation: string;
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  yearsOfExperience: number;
  targetRoles: string[];
  skills: string[];
  resumeMarkdown: string;
  confidenceScores: Record<string, number>;
}

/**
 * Extracts plain text from an uploaded resume file (supports PDF, Markdown, and TXT).
 */
export async function extractRawTextFromFile(file: File): Promise<string> {
  const fileName = file.name.toLowerCase();

  // 1. PDF Documents
  if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await extractText(arrayBuffer, { mergePages: true });
      const text = typeof result.text === 'string'
        ? result.text
        : Array.isArray(result.text)
        ? (result.text as string[]).join('\n\n')
        : '';
      if (text && text.trim().length > 20) {
        return text;
      }
    } catch (err) {
      console.warn('[ResumeParser] PDF extraction via unpdf failed, falling back:', err);
    }
  }

  // 2. Plain Text / Markdown / Other Documents
  try {
    return await file.text();
  } catch (err) {
    throw new Error(`Unable to read file "${file.name}". Please ensure it is a valid PDF, Markdown, or TXT file.`);
  }
}

/**
 * Deterministically parses contact info, links, experience, and skills from resume text.
 */
export function extractResumeDetailsHeuristic(rawText: string): ExtractedResumeDetails {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const confidenceScores: Record<string, number> = {};

  // 1. Email Extraction
  const emails = extractEmails(rawText);
  const email = emails[0] || '';
  if (email) confidenceScores.email = 0.95;

  // 2. Phone Number Extraction
  let phone = '';
  const phonePatterns = [
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, // US/Standard: (123) 456-7890
    /(?:\+91[\s-]?)?[6-9]\d{9}\b/,                                  // India: +91 9876543210
    /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/,        // International
  ];

  for (const pattern of phonePatterns) {
    const match = rawText.match(pattern);
    if (match) {
      phone = match[0].trim();
      confidenceScores.phone = 0.9;
      break;
    }
  }

  // 3. LinkedIn Profile URL
  let linkedinUrl = '';
  const linkedinMatch = rawText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_\-%]+)/i);
  if (linkedinMatch) {
    linkedinUrl = `https://www.linkedin.com/in/${linkedinMatch[1]}`;
    confidenceScores.linkedinUrl = 0.95;
  }

  // 4. GitHub Profile URL
  let githubUrl = '';
  const githubMatch = rawText.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_\-]+)/i);
  if (githubMatch) {
    const user = githubMatch[1].toLowerCase();
    const ignored = new Set(['topics', 'pricing', 'features', 'explore', 'trending', 'about', 'join', 'login']);
    if (!ignored.has(user)) {
      githubUrl = `https://github.com/${githubMatch[1]}`;
      confidenceScores.githubUrl = 0.95;
    }
  }

  // 5. Portfolio / Personal Website
  let portfolioUrl = '';
  const portfolioKeywords = /(?:portfolio|website|site|homepage):\s*(https?:\/\/[^\s]+)/i;
  const kwMatch = rawText.match(portfolioKeywords);
  if (kwMatch) {
    portfolioUrl = kwMatch[1].trim();
    confidenceScores.portfolioUrl = 0.9;
  } else {
    // Scan top 15 lines for standalone personal website (e.g., .dev, .me, .io, .info, .tech)
    const urlPattern = /https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.(?:dev|me|io|tech|info|page|design|app|com|org))\b/gi;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlPattern.exec(lines.slice(0, 15).join(' '))) !== null) {
      const foundUrl = urlMatch[0];
      if (
        !foundUrl.includes('linkedin.com') &&
        !foundUrl.includes('github.com') &&
        !foundUrl.includes('twitter.com') &&
        !foundUrl.includes('x.com')
      ) {
        portfolioUrl = foundUrl;
        confidenceScores.portfolioUrl = 0.8;
        break;
      }
    }
  }

  // 6. Full Name Extraction (Candidate Header)
  let fullName = '';
  const stopWords = new Set([
    'resume', 'curriculum', 'vitae', 'cv', 'profile', 'summary',
    'contact', 'experience', 'education', 'skills', 'projects',
    'developer', 'engineer', 'software', 'senior', 'junior', 'fullstack'
  ]);

  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const candidate = lines[i].replace(/[^\w\s.-]/g, '').trim();
    const words = candidate.split(/\s+/).filter(Boolean);

    // Names typically contain 2-4 words, length between 4 and 35 chars
    if (words.length >= 2 && words.length <= 4 && candidate.length >= 4 && candidate.length <= 35) {
      const lower = candidate.toLowerCase();
      const hasStopWord = words.some((w) => stopWords.has(w.toLowerCase()));
      const hasNumbers = /\d/.test(candidate);
      const isEmail = candidate.includes('@');

      if (!hasStopWord && !hasNumbers && !isEmail) {
        // Normalize capitalization (e.g. "JOHN DOE" -> "John Doe")
        fullName = words
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        confidenceScores.fullName = 0.85;
        break;
      }
    }
  }

  // 7. Location Extraction
  let currentLocation = '';
  const locationHeaderMatch = rawText.match(/(?:Location|Address|Based in|City|Residence):\s*([A-Za-z0-9\s,.-]+)/i);
  if (locationHeaderMatch && locationHeaderMatch[1]) {
    currentLocation = locationHeaderMatch[1].split('\n')[0].trim();
    confidenceScores.currentLocation = 0.85;
  } else {
    // Look in top 15 lines for standard "City, ST" or "City, Country"
    const locationPattern = /\b([A-Z][a-zA-Z\s.-]+,\s*(?:[A-Z]{2}|India|USA|United States|UK|United Kingdom|Canada|Germany|Australia|Singapore))\b/;
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const match = lines[i].match(locationPattern);
      if (match) {
        currentLocation = match[1].trim();
        confidenceScores.currentLocation = 0.75;
        break;
      }
    }
  }

  // 8. Years of Experience
  let yearsOfExperience = 0;
  // Check explicit pattern: "5+ years of experience"
  const expPattern = /(\d+)\+?\s*years?(?:\s*of)?\s*(?:experience|professional)/i;
  const expMatch = rawText.match(expPattern);
  if (expMatch) {
    yearsOfExperience = parseInt(expMatch[1], 10);
    confidenceScores.yearsOfExperience = 0.85;
  } else {
    // Estimate from earliest professional year (e.g. 2018 - Present, 2020 - 2024)
    const currentYear = new Date().getFullYear();
    const yearMatches = rawText.match(/\b(200\d|201\d|202[0-6])\b/g);
    if (yearMatches && yearMatches.length >= 2) {
      const validYears = yearMatches
        .map((y) => parseInt(y, 10))
        .filter((y) => y >= 2000 && y <= currentYear);

      if (validYears.length > 0) {
        const earliest = Math.min(...validYears);
        const calculated = currentYear - earliest;
        if (calculated >= 1 && calculated <= 35) {
          yearsOfExperience = calculated;
          confidenceScores.yearsOfExperience = 0.7;
        }
      }
    }
  }

  // 9. Target Roles Whitelist Extraction
  const targetRoles: string[] = [];
  const standardRoles = [
    'Software Engineer',
    'Full Stack Developer',
    'Frontend Developer',
    'Backend Developer',
    'React Developer',
    'Node.js Developer',
    'Python Developer',
    'DevOps Engineer',
    'Site Reliability Engineer',
    'Cloud Engineer',
    'Mobile Developer',
    'Android Developer',
    'iOS Developer',
    'Machine Learning Engineer',
    'AI Engineer',
    'Data Scientist',
    'Data Engineer',
    'Product Manager',
    'UI/UX Designer',
  ];

  const lowerText = rawText.toLowerCase();
  for (const role of standardRoles) {
    if (lowerText.includes(role.toLowerCase())) {
      targetRoles.push(role);
    }
  }
  if (targetRoles.length > 0) {
    confidenceScores.targetRoles = 0.8;
  }

  // 10. Key Skills Extraction
  const commonSkills = [
    'JavaScript', 'TypeScript', 'React', 'Next.js', 'Vue.js', 'Angular',
    'Node.js', 'Express', 'Python', 'Django', 'FastAPI', 'Go', 'Golang',
    'Rust', 'Java', 'Spring Boot', 'C++', 'C#', '.NET', 'SQL', 'PostgreSQL',
    'MySQL', 'MongoDB', 'Redis', 'GraphQL', 'REST API', 'AWS', 'GCP', 'Azure',
    'Docker', 'Kubernetes', 'CI/CD', 'Git', 'Linux', 'Tailwind CSS', 'Redux'
  ];

  const skills: string[] = [];
  for (const skill of commonSkills) {
    const skillRegex = new RegExp(`\\b${skill.replace(/[.+]/g, '\\$&')}\\b`, 'i');
    if (skillRegex.test(rawText)) {
      skills.push(skill);
    }
  }

  // 11. Clean Structured Markdown Resume Representation
  const resumeMarkdown = generateCleanResumeMarkdown({
    fullName,
    email,
    phone,
    currentLocation,
    linkedinUrl,
    githubUrl,
    portfolioUrl,
    rawText,
    skills,
    targetRoles,
  });

  return {
    fullName,
    email,
    phone,
    currentLocation,
    portfolioUrl,
    linkedinUrl,
    githubUrl,
    yearsOfExperience,
    targetRoles,
    skills,
    resumeMarkdown,
    confidenceScores,
  };
}

/**
 * Formats the raw extracted text into clean, structured Markdown suitable for LLM injection.
 */
function generateCleanResumeMarkdown(data: {
  fullName: string;
  email: string;
  phone: string;
  currentLocation: string;
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  rawText: string;
  skills: string[];
  targetRoles: string[];
}): string {
  const parts: string[] = [];

  // Header
  if (data.fullName) {
    parts.push(`# ${data.fullName}`);
  }

  const contactItems = [
    data.email,
    data.phone,
    data.currentLocation,
    data.linkedinUrl,
    data.githubUrl,
    data.portfolioUrl,
  ].filter(Boolean);

  if (contactItems.length > 0) {
    parts.push(contactItems.join(' | '));
  }

  if (data.targetRoles.length > 0) {
    parts.push(`\n**Target Roles:** ${data.targetRoles.join(', ')}`);
  }

  if (data.skills.length > 0) {
    parts.push(`\n**Key Technical Skills:** ${data.skills.join(', ')}`);
  }

  // Clean raw body text
  const cleanBody = data.rawText
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  parts.push('\n---\n\n' + cleanBody);

  return parts.join('\n');
}

/**
 * Optional AI Refiner: Sends resume text to the configured LLM client
 * (OpenAI, Claude, Groq, Ollama) to extract precise structured details.
 */
export async function extractResumeDetailsAI(
  rawText: string,
  config?: LLMConfig
): Promise<Partial<ExtractedResumeDetails>> {
  const systemPrompt = `You are an expert resume parsing engine. Given the candidate's resume text, extract accurate details strictly adhering to the JSON schema.`;
  const userPrompt = `Extract the candidate's profile details from this resume text:

"""
${rawText.slice(0, 8000)}
"""

Respond ONLY with valid JSON in this exact structure:
{
  "fullName": "Candidate Full Name",
  "email": "primary.email@example.com",
  "phone": "+1234567890",
  "currentLocation": "City, Country or City, State",
  "portfolioUrl": "https://portfolio.dev",
  "linkedinUrl": "https://linkedin.com/in/username",
  "githubUrl": "https://github.com/username",
  "yearsOfExperience": 5,
  "targetRoles": ["Role 1", "Role 2"],
  "skills": ["Skill 1", "Skill 2"]
}`;

  try {
    return await callLLMJson<Partial<ExtractedResumeDetails>>(systemPrompt, userPrompt, config);
  } catch (err) {
    console.warn('[ResumeParser] AI extraction failed or in MCP mode, falling back to heuristics:', err);
    return {};
  }
}

/**
 * High-level resume ingestion pipeline:
 * 1. Reads text from file (PDF, TXT, MD).
 * 2. Runs deterministic heuristics.
 * 3. Enriches via AI if an active LLM provider (OpenAI, Claude, Groq) is configured.
 */
export async function parseResumeFile(
  file: File
): Promise<{ details: ExtractedResumeDetails; usedAi: boolean }> {
  const rawText = await extractRawTextFromFile(file);
  const heuristicDetails = extractResumeDetailsHeuristic(rawText);

  const settings = await getAppSettings();
  const llmConfig = settings?.llmConfig;

  let usedAi = false;
  if (llmConfig && llmConfig.provider !== 'mcp' && llmConfig.apiKey) {
    try {
      const aiDetails = await extractResumeDetailsAI(rawText, llmConfig);
      if (aiDetails && Object.keys(aiDetails).length > 0) {
        usedAi = true;
        // Merge AI details with heuristics (preserving any fields AI left blank)
        return {
          details: {
            ...heuristicDetails,
            fullName: aiDetails.fullName || heuristicDetails.fullName,
            email: aiDetails.email || heuristicDetails.email,
            phone: aiDetails.phone || heuristicDetails.phone,
            currentLocation: aiDetails.currentLocation || heuristicDetails.currentLocation,
            portfolioUrl: aiDetails.portfolioUrl || heuristicDetails.portfolioUrl,
            linkedinUrl: aiDetails.linkedinUrl || heuristicDetails.linkedinUrl,
            githubUrl: aiDetails.githubUrl || heuristicDetails.githubUrl,
            yearsOfExperience: typeof aiDetails.yearsOfExperience === 'number'
              ? aiDetails.yearsOfExperience
              : heuristicDetails.yearsOfExperience,
            targetRoles: aiDetails.targetRoles?.length
              ? Array.from(new Set([...heuristicDetails.targetRoles, ...aiDetails.targetRoles]))
              : heuristicDetails.targetRoles,
            skills: aiDetails.skills?.length
              ? Array.from(new Set([...heuristicDetails.skills, ...aiDetails.skills]))
              : heuristicDetails.skills,
          },
          usedAi: true,
        };
      }
    } catch {
      // Graceful fallback to heuristics
    }
  }

  return { details: heuristicDetails, usedAi };
}
