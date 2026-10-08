import type {
  UserProfile,
  ScrapedJob,
  ExtractedContact,
  GeneratedArtifacts,
  LLMConfig,
} from './types';
import { getAppSettings } from './storage';

export interface FormAnswerResult {
  answer: string;
  confidence: number;
  reasoning?: string;
}

export interface PitchAndLetterResult {
  coverLetter: string;
  pitchNote: string;
}

export interface ColdOutreachResult {
  emailSubject: string;
  coldEmail: string;
  linkedinConnectionNote: string;
}

/**
 * Universal LLM caller supporting OpenAI-compatible APIs (OpenAI, Groq, Ollama, custom)
 * and Anthropic Claude messages format.
 */
export async function callLLMJson<T>(
  systemPrompt: string,
  userPrompt: string,
  config?: LLMConfig
): Promise<T> {
  const activeConfig = config || (await getAppSettings()).llmConfig;

  if (!activeConfig) {
    throw new Error('LLM configuration not found.');
  }

  // 1. MCP Coding Agent Handler (relies on agent orchestration & heuristic fallbacks)
  if (activeConfig.provider === 'mcp') {
    throw new Error('MCP Coding Agent mode: Generation is handled via connected agent or local heuristics.');
  }

  // 2. Anthropic Claude Direct API Handler
  if (activeConfig.provider === 'claude') {
    return await callAnthropicClaude<T>(systemPrompt, userPrompt, activeConfig);
  }

  // 3. OpenAI-compatible Handler (OpenAI, Groq, Ollama, Custom, Azure)
  let endpoint = activeConfig.baseUrl.trim();
  if (!endpoint) {
    endpoint =
      activeConfig.provider === 'azure'
        ? 'https://abhishek-0588-resource.openai.azure.com/openai/v1'
        : activeConfig.provider === 'groq'
        ? 'https://api.groq.com/openai/v1'
        : activeConfig.provider === 'ollama'
        ? 'http://localhost:11434/v1'
        : 'https://api.openai.com/v1';
  }
  endpoint = endpoint.replace(/\/+$/, '');
  const url = `${endpoint}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (activeConfig.apiKey && activeConfig.apiKey.trim().length > 0) {
    const key = activeConfig.apiKey.trim();
    headers['Authorization'] = `Bearer ${key}`;
    headers['api-key'] = key;
  }

  const payload: any = {
    model: activeConfig.model || (activeConfig.provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content: `${systemPrompt}\nIMPORTANT: You MUST respond ONLY with valid JSON matching the requested structure. Do not include markdown ticks or explanations outside the JSON object.`,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    temperature: activeConfig.temperature ?? 0.2,
    response_format: { type: 'json_object' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM Request failed [${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content?.trim() || '';

  return parseJsonFromResponse<T>(rawContent);
}

/**
 * Anthropic Messages API caller
 */
async function callAnthropicClaude<T>(
  systemPrompt: string,
  userPrompt: string,
  config: LLMConfig
): Promise<T> {
  let endpoint = config.baseUrl?.trim() || 'https://api.anthropic.com/v1';
  endpoint = endpoint.replace(/\/+$/, '');
  const url = `${endpoint}/messages`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey.trim(),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const payload = {
    model: config.model || 'claude-3-5-sonnet-latest',
    max_tokens: 1500,
    system: `${systemPrompt}\nIMPORTANT: You MUST reply ONLY with a raw JSON object string. Do not wrap in markdown or backticks.`,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    temperature: config.temperature ?? 0.2,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude Request failed [${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text?.trim() || '';
  return parseJsonFromResponse<T>(text);
}

/**
 * Safely parses JSON from LLM output, extracting from markdown blocks if needed.
 */
function parseJsonFromResponse<T>(raw: string): T {
  let clean = raw.trim();

  // Strip ```json and ```
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  // Find boundaries of JSON object if wrapped in text
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(clean) as T;
}

// ============================================================================
// 1. generateFormAnswer
// ============================================================================

export async function generateFormAnswer(
  fieldLabel: string,
  fieldType: 'text' | 'number' | 'radio' | 'select',
  options: string[],
  profile: UserProfile,
  jobContext: string,
  config?: LLMConfig
): Promise<FormAnswerResult> {
  const normLabel = fieldLabel.toLowerCase().trim();

  // Check custom answers first
  if (profile.customAnswers?.length) {
    for (const ca of profile.customAnswers) {
      if (ca.questionPattern && normLabel.includes(ca.questionPattern.toLowerCase())) {
        return {
          answer: ca.answer,
          confidence: 1.0,
          reasoning: `Matched user custom preset rule for '${ca.questionPattern}'`,
        };
      }
    }
  }

  // Heuristic rule matching before calling LLM
  const heuristic = matchHeuristicAnswer(normLabel, fieldType, options, profile);
  if (heuristic && heuristic.confidence >= 0.95) {
    return heuristic;
  }

  // Attempt LLM call if configured
  try {
    const systemPrompt = `You are an expert autonomous job application form filler representing a candidate.
You are given a form question label, the input type, allowed options (if any), the candidate's profile, and the job context.
Output a JSON object with:
{
  "answer": "string (the exact answer or selected option text)",
  "confidence": number (from 0.0 to 1.0),
  "reasoning": "brief explanation"
}

STRICT CONSTRAINTS & FACTUAL TRUTH:
1. Base years of experience strictly on the candidate's actual background and total years of professional experience (${profile.yearsOfExperience} years). If a technology is unmentioned in the candidate's resume, do NOT fabricate experience—return "0" or an honest assessment based on actual skills. NEVER fabricate experience.
2. If asking for salary or compensation, return the candidate's expected salary numeric: "${profile.expectedSalaryNumeric}".
3. If asking for notice period, return "${profile.noticePeriodDays}".
4. If options are provided (for radio or select), the "answer" MUST EXACTLY match one of the options in the options list.
5. For sponsorship/visa questions: Candidate requires sponsorship = ${profile.workAuthorization.requiresSponsorship}, is authorized = ${profile.workAuthorization.authorizedInTargetCountry}.
6. For citizenship: US Citizen = ${profile.workAuthorization.usCitizen}.
7. NEVER invent, hallucinate, or fabricate ANY qualifications, degrees, metrics, or experiences not explicitly stated in the candidate's profile.`;

    const userPrompt = `Form Question Label: "${fieldLabel}"
Input Type: "${fieldType}"
Available Options: ${JSON.stringify(options)}
Job Context:
${jobContext}

Candidate Profile Summary:
Name: ${profile.fullName}
Experience: ${profile.yearsOfExperience} years
Notice Period: ${profile.noticePeriodDays} days
Salary Expectation: ${profile.expectedSalaryNumeric} ${profile.currency}
Resume:
${profile.resumeMarkdown}`;

    const result = await callLLMJson<FormAnswerResult>(systemPrompt, userPrompt, config);
    if (result && typeof result.answer === 'string') {
      return result;
    }
  } catch (err) {
    console.warn(`[AI] LLM form answer generation failed for "${fieldLabel}":`, err);
  }

  // Fallback to heuristic
  return heuristic || { answer: 'Yes', confidence: 0.5, reasoning: 'Default fallback answer' };
}

function matchHeuristicAnswer(
  normLabel: string,
  fieldType: 'text' | 'number' | 'radio' | 'select',
  options: string[],
  profile: UserProfile
): FormAnswerResult | null {
  // Years of experience
  if (
    normLabel.includes('years of experience') ||
    normLabel.includes('how many years') ||
    (normLabel.includes('experience') && fieldType === 'number')
  ) {
    return {
      answer: String(profile.yearsOfExperience),
      confidence: 0.95,
      reasoning: 'Profile years of experience match',
    };
  }

  // Expected salary
  if (
    normLabel.includes('salary') ||
    normLabel.includes('compensation') ||
    normLabel.includes('pay expectation') ||
    normLabel.includes('ctc')
  ) {
    return {
      answer: String(profile.expectedSalaryNumeric),
      confidence: 0.95,
      reasoning: 'Profile expected salary match',
    };
  }

  // Notice period
  if (normLabel.includes('notice period') || normLabel.includes('how soon can you start')) {
    if (fieldType === 'number') {
      return { answer: String(profile.noticePeriodDays), confidence: 0.95 };
    }
    const matchOption = options.find((o) =>
      o.toLowerCase().includes('30') || o.toLowerCase().includes('month') || o.toLowerCase().includes('immediately')
    );
    return {
      answer: matchOption || `${profile.noticePeriodDays} days`,
      confidence: 0.95,
    };
  }

  // Country code dropdown / select
  if (normLabel.includes('country code') || normLabel.includes('phone code')) {
    const matchOption = options.find((o) =>
      o.toLowerCase().includes('india') || o.includes('+91')
    );
    return {
      answer: matchOption || 'India (+91)',
      confidence: 1.0,
      reasoning: 'Profile country code match',
    };
  }

  // Phone / Email / City
  if (normLabel.includes('phone') || normLabel.includes('mobile')) {
    const cleanDigits = profile.phone.replace(/\D/g, '');
    const tenDigits = cleanDigits.length > 10 ? cleanDigits.slice(-10) : cleanDigits;
    return { answer: tenDigits || profile.phone, confidence: 1.0 };
  }
  if (normLabel.includes('email')) {
    return { answer: profile.email, confidence: 1.0 };
  }
  if (normLabel.includes('location') || normLabel.includes('city') || normLabel.includes('address')) {
    return { answer: profile.currentLocation, confidence: 0.95 };
  }
  if (normLabel.includes('linkedin') && normLabel.includes('url')) {
    return { answer: profile.linkedinUrl, confidence: 1.0 };
  }
  if (normLabel.includes('github') && normLabel.includes('url')) {
    return { answer: profile.githubUrl, confidence: 1.0 };
  }
  if (normLabel.includes('website') || normLabel.includes('portfolio')) {
    return { answer: profile.portfolioUrl, confidence: 1.0 };
  }

  // Sponsorship questions
  if (normLabel.includes('sponsorship') || normLabel.includes('visa')) {
    const answer = profile.workAuthorization.requiresSponsorship ? 'Yes' : 'No';
    const matchedOption = options.find((o) => o.toLowerCase().startsWith(answer.toLowerCase()));
    return {
      answer: matchedOption || answer,
      confidence: 0.98,
      reasoning: 'Work authorization sponsorship preference',
    };
  }

  // Legally authorized to work
  if (
    normLabel.includes('authorized to work') ||
    normLabel.includes('legally authorized') ||
    normLabel.includes('right to work')
  ) {
    const answer = profile.workAuthorization.authorizedInTargetCountry ? 'Yes' : 'No';
    const matchedOption = options.find((o) => o.toLowerCase().startsWith(answer.toLowerCase()));
    return {
      answer: matchedOption || answer,
      confidence: 0.98,
      reasoning: 'Work authorization country right to work',
    };
  }

  // Citizen
  if (normLabel.includes('citizen')) {
    const answer = profile.workAuthorization.usCitizen ? 'Yes' : 'No';
    const matchedOption = options.find((o) => o.toLowerCase().startsWith(answer.toLowerCase()));
    return {
      answer: matchedOption || answer,
      confidence: 0.98,
    };
  }

  // Background check / 18 years of age / Drug screen
  if (
    normLabel.includes('18 years') ||
    normLabel.includes('background check') ||
    normLabel.includes('drug screen') ||
    normLabel.includes('terms and conditions') ||
    normLabel.includes('privacy policy')
  ) {
    const matchedOption = options.find((o) => o.toLowerCase().startsWith('yes') || o.toLowerCase().includes('agree'));
    return { answer: matchedOption || 'Yes', confidence: 0.95 };
  }

  // Radio or select with Yes / No options
  if ((fieldType === 'radio' || fieldType === 'select') && options.length > 0) {
    const yesOpt = options.find((o) => o.trim().toLowerCase() === 'yes');
    if (yesOpt) {
      return { answer: yesOpt, confidence: 0.6, reasoning: 'Default positive response' };
    }
    return { answer: options[0], confidence: 0.5, reasoning: 'First available option' };
  }

  return null;
}

// ============================================================================
// 2. generatePitchAndLetter
// ============================================================================

export async function generatePitchAndLetter(
  profile: UserProfile,
  job: ScrapedJob,
  config?: LLMConfig
): Promise<PitchAndLetterResult> {
  try {
    const systemPrompt = `You are a world-class tech career advisor and executive copywriter representing a candidate for a job application.
Generate:
1. "coverLetter": A tailored 3-paragraph cover letter strictly grounded in the candidate's verified experience and the full job description.
   - Paragraph 1: Direct hook connecting the candidate's background to ${job.company}'s specific mission/product and the ${job.title} role.
   - Paragraph 2: Core technical capabilities, architecture decisions, and real past projects from the candidate's resume that directly match the job requirements.
   - Paragraph 3: Professional closing expressing enthusiasm and readiness to contribute.
2. "pitchNote": A concise ~120-150 word high-impact pitch note answering "Why are you interested in this role?" for Wellfound/AngelList or recruiter notes.

CRITICAL TRUTH & ANTI-HALLUCINATION DIRECTIVES:
- ZERO FAKE METRICS / ZERO FABRICATED ACHIEVEMENTS: You MUST strictly adhere to the facts, skills, technologies, projects, and accomplishments explicitly present in the candidate's resume.
- If the candidate's resume does NOT state a quantitative metric, percentage, or specific achievement (e.g. "% latency reduction", "X million users", "$Y revenue"), DO NOT INVENT, ASSUME, OR ADD ANY METRICS.
- NEVER invent degrees, previous employers, awards, patents, or certifications not explicitly documented in the candidate's resume.
- NEVER generate fake, exaggerated, or fabricated information of any kind.
- Speak with genuine technical credibility about the candidate's real stack, architecture decisions, and real projects.

Output JSON:
{
  "coverLetter": "string",
  "pitchNote": "string"
}`;

    const userPrompt = `Target Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Platform: ${job.platform}

Complete Scraped Job Description & Details:
${job.jobDescription}

Candidate Profile:
Name: ${profile.fullName}
Email: ${profile.email}
Phone: ${profile.phone}
Portfolio: ${profile.portfolioUrl}
GitHub: ${profile.githubUrl}
LinkedIn: ${profile.linkedinUrl}
Years of Experience: ${profile.yearsOfExperience}
Full Resume:
${profile.resumeMarkdown}`;

    const res = await callLLMJson<PitchAndLetterResult>(systemPrompt, userPrompt, config);
    if (res.coverLetter && res.pitchNote) {
      return res;
    }
  } catch (err) {
    console.warn('[AI] Error generating pitch and cover letter via LLM, using fallback:', err);
  }

  // High-fidelity fallback
  return generateFallbackPitchAndLetter(profile, job);
}

function generateFallbackPitchAndLetter(
  profile: UserProfile,
  job: ScrapedJob
): PitchAndLetterResult {
  const candidateName = profile.fullName || 'Candidate';
  const expText = profile.yearsOfExperience
    ? `With over ${profile.yearsOfExperience} years of experience`
    : 'With a strong track record';

  const contactDetails = [
    candidateName,
    [profile.email, profile.phone].filter(Boolean).join(' | '),
    profile.portfolioUrl || profile.linkedinUrl || '',
  ]
    .filter(Boolean)
    .join('\n');

  const coverLetter = `Dear Hiring Team at ${job.company},

I am writing to express my enthusiastic interest in the ${job.title} role. ${expText} architecting resilient software, shipping scalable web systems, and driving high-impact technical initiatives, I am eager to contribute immediately to ${job.company}'s mission.

Throughout my career, I have specialized in bridging high-level architectural vision with hands-on technical execution. My technical background and product iteration focus directly align with the technical goals required for ${job.title}. Whether optimizing critical performance bottlenecks or building intuitive, responsive interfaces, I focus on delivering tangible business value and elevating team engineering standards.

I welcome the opportunity to discuss how my technical expertise and proactive problem-solving can help ${job.company} accelerate its product roadmap. Thank you for your time and consideration.

Warm regards,
${contactDetails}`;

  const pitchNote = `Hi ${job.company} team! I'm ${candidateName}, an engineer passionate about building scalable systems and polished web applications. I was drawn to ${job.company}'s opening for ${job.title} because it aligns directly with my engineering focus: high-performance architecture, product craftsmanship, and collaborative delivery. I would love to connect and share how my technical background can make an immediate impact on your team!`;

  return { coverLetter, pitchNote };
}

// ============================================================================
// 3. generateColdOutreach
// ============================================================================

export async function generateColdOutreach(
  profile: UserProfile,
  job: ScrapedJob,
  contactInfo: ExtractedContact,
  config?: LLMConfig
): Promise<ColdOutreachResult> {
  const recipientName = contactInfo.recruiterName || 'Hiring Team';
  const candidateName = profile.fullName || 'Candidate';

  try {
    const systemPrompt = `You are an elite tech recruitment copywriter specializing in executive cold outreach.
Generate:
1. "emailSubject": A high-converting subject line (e.g., "${job.title} inquiry - ${candidateName}")
2. "coldEmail": A 3-paragraph punchy cold email with a clear Call to Action (CTA).
   - Paragraph 1: Enthusiastic personalized introduction addressing ${recipientName} regarding the ${job.title} role at ${job.company}.
   - Paragraph 2: Core proof points highlighting relevant technical stack and past project outcomes verified from the candidate's resume.
   - Paragraph 3: Low-friction CTA inviting a brief 10-minute introductory sync.
3. "linkedinConnectionNote": A strictly under 300 character LinkedIn connection request note customized for ${recipientName}.

CRITICAL TRUTH & ANTI-HALLUCINATION DIRECTIVES:
- NEVER fabricate, invent, or assume any metrics, percentages, numbers, or achievements not explicitly stated in the candidate's resume.
- Only reference real technologies, architectures, and projects that exist in the candidate's profile.
- If the candidate's resume does not contain a quantitative metric, DO NOT add one.

Output JSON:
{
  "emailSubject": "string",
  "coldEmail": "string",
  "linkedinConnectionNote": "string (MUST BE UNDER 300 CHARACTERS)"
}`;

    const userPrompt = `Job Title: ${job.title}
Company: ${job.company}
Recipient Name: ${recipientName}
Complete Job Description & Requirements:
${job.jobDescription}

Candidate Profile:
Name: ${candidateName}
Experience: ${profile.yearsOfExperience || 0} years
Full Resume:
${profile.resumeMarkdown}`;

    const res = await callLLMJson<ColdOutreachResult>(systemPrompt, userPrompt, config);
    if (res.coldEmail && res.emailSubject && res.linkedinConnectionNote) {
      // Ensure LinkedIn note does not exceed 300 chars
      if (res.linkedinConnectionNote.length > 295) {
        res.linkedinConnectionNote = res.linkedinConnectionNote.slice(0, 290) + '...';
      }
      return res;
    }
  } catch (err) {
    console.warn('[AI] Error generating cold outreach via LLM, using fallback:', err);
  }

  // Fallback cold outreach
  const emailSubject = `${job.title} role at ${job.company} - ${candidateName}`;
  const expIntro = profile.yearsOfExperience
    ? `Over the past ${profile.yearsOfExperience} years, I've`
    : `Throughout my career, I've`;

  const contactDetails = [
    candidateName,
    [profile.email, profile.phone].filter(Boolean).join(' | '),
    profile.portfolioUrl || profile.linkedinUrl || '',
  ]
    .filter(Boolean)
    .join('\n');

  const coldEmail = `Hi ${recipientName},

I hope you're having a productive week. I recently came across the ${job.title} opening at ${job.company} and was immediately compelled to reach out given how closely my experience aligns with your team's goals.

${expIntro} built and scaled modern distributed applications and user-facing products with high uptime and rigorous standards. My core focus spans modern web frameworks, performant architectures, and full-lifecycle engineering.

Would you be open to a brief 10-minute introductory conversation sometime this week to discuss how my skill set could benefit ${job.company}?

Best regards,

${contactDetails}`;

  let linkedinConnectionNote = `Hi ${recipientName}, I noticed the ${job.title} role at ${job.company}. With my background building scalable software, I'd love to connect and explore how my experience fits your team!`;
  if (linkedinConnectionNote.length > 295) {
    linkedinConnectionNote = `Hi ${recipientName}, noticed the ${job.title} opening at ${job.company}. Would love to connect and discuss how my background fits your team!`;
  }

  return { emailSubject, coldEmail, linkedinConnectionNote };
}
