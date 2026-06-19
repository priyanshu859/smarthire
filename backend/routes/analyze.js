const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');
const rateLimit = require('express-rate-limit');

const upload = multer({ storage: multer.memoryStorage() });

const ALLOWED_EXTS = new Set(['.pdf', '.doc', '.docx', '.txt']);
const AI_SERVICE = process.env.AI_SERVICE_URL || 'http://localhost:8001';

const bulkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 bulk requests per IP
  message: { error: 'Too many requests, please try again later.' }
});

// ── Text extraction — O(n) where n = file size ────────────────────────────
async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf') {
    try { return (await pdfParse(file.buffer)).text || ''; } catch { return ''; }
  }
  if (ext === '.docx' || ext === '.doc') {
    try { return (await mammoth.extractRawText({ buffer: file.buffer })).value || ''; } catch { return ''; }
  }
  if (ext === '.txt') return file.buffer.toString('utf-8');
  return '';
}

// ── GitHub username extraction — O(n) single regex pass ──────────────────
function extractGithubUsername(text) {
  const match = text.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

// ── GitHub check — O(r) where r = repo count, max 100 ───────────────────
async function checkGithub(username) {
  try {
    const res = await fetch(`https://api.github.com/users/${username}/repos?per_page=100`, {
      headers: {
        'User-Agent': 'SmartHire-App',
        ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` })
      }
    });
    const repos = await res.json();
    if (!Array.isArray(repos)) return { verified: false, score: 0, details: 'No repos found' };

    const now = Date.now();
    const SIX_MONTHS_MS   = 6 * 30 * 24 * 60 * 60 * 1000;
    const EIGHT_MONTHS_MS = 8 * 30 * 24 * 60 * 60 * 1000;

    let totalStars = 0;
    let validRepos = 0;
    let recentlyActive = 0;
    const langSet = new Set();

    // Single O(r) pass — no separate filter/reduce calls
    for (const r of repos) {
      totalStars += r.stargazers_count;
      if (r.language) langSet.add(r.language);
      const age = now - new Date(r.created_at).getTime();
      if (!r.fork && age >= EIGHT_MONTHS_MS) validRepos++;
      if (now - new Date(r.pushed_at).getTime() <= SIX_MONTHS_MS) recentlyActive++;
    }

    const score =
      (totalStars > 0 ? 5 : 0) +
      (totalStars > 10 ? 5 : 0) +
      (recentlyActive > 0 ? 10 : 0) +
      (validRepos >= 2 ? 10 : 0);

    return {
      verified: validRepos > 0,
      score,
      details: {
        totalRepos: repos.length,
        validRepos,
        recentlyActive,
        totalStars,
        languages: [...langSet]
      }
    };
  } catch {
    return { verified: false, score: 0, details: 'GitHub check failed' };
  }
}

// ── AI call ────────────────────────────────────────────────────────────────
async function analyzeWithAI(jobDescription, resumeText, pdfBuffer) {
  const res = await fetch(`${AI_SERVICE}/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobDescription,
      resumeText,
      pdfBase64: pdfBuffer ? pdfBuffer.toString('base64') : null
    })
  });
  return res.json();
}

// ── Garbage result factory ─────────────────────────────────────────────────
const garbageResult = (filename, reason) => ({
  filename,
  is_resume: false,
  match_score: 0,
  strengths: [],
  skill_gaps: [],
  summary: reason,
  resume_text: '',
  github: { username: null, verified: false, details: 'N/A' },
  shortlisted: false
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main route ─────────────────────────────────────────────────────────────
router.post('/analyze-bulk', bulkLimiter, upload.array('resumes', 100), async (req, res) => {
  const { jobDescription } = req.body;
  if (!jobDescription) return res.status(400).json({ error: 'Job description required' });
  if (!req.files?.length) return res.status(400).json({ error: 'No resumes uploaded' });

  try {
    const results = [];

    for (let i = 0; i < req.files.length; i++) {
      if (i > 0) await sleep(1500); // respect Groq 12k TPM limit

      const file = req.files[i];
      const ext = path.extname(file.originalname).toLowerCase();

      // 1. Unsupported extension → reject without AI call
      if (!ALLOWED_EXTS.has(ext)) {
        results.push(garbageResult(file.originalname, 'Unsupported file type'));
        continue;
      }

      const resumeText = await extractText(file);
      const needsOCR = ext === '.pdf' && !resumeText.trim();

      // 2. AI decides is_resume
      const aiResult = await analyzeWithAI(jobDescription, resumeText, needsOCR ? file.buffer : null);

      // 3. Not a resume → reject
      if (aiResult.is_resume !== true) {
        results.push(garbageResult(file.originalname, aiResult.summary || 'Not a resume'));
        continue;
      }

      // 4. Valid resume — GitHub + scoring
      const githubUsername = extractGithubUsername(resumeText);
      const githubData = githubUsername
        ? await checkGithub(githubUsername)
        : { verified: false, score: 0, details: 'No GitHub link found' };

      const finalScore = Math.min(100, (aiResult.match_score || 0) + githubData.score);

      // Fire-and-forget DB insert — don't block the response
      pool.query(
        'INSERT INTO analyses (job_description, resume_text, match_score, skill_gaps) VALUES ($1, $2, $3, $4)',
        [jobDescription, resumeText.slice(0, 5000), finalScore, aiResult.skill_gaps]
      ).catch(err => console.error('DB insert error:', err));

      results.push({
        filename: file.originalname,
        ...aiResult,
        is_resume: true,
        match_score: finalScore,
        shortlisted: finalScore >= 70,
        resume_text: resumeText.slice(0, 8000),
        github: {
          username: githubUsername,
          verified: githubData.verified,
          details: githubData.details
        }
      });
    }

    // Sort descending by score — O(n log n)
    results.sort((a, b) => b.match_score - a.match_score);
    res.json({ candidates: results, total: results.length });

  } catch (err) {
    console.error('Bulk analyze error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Seeker: extract text from uploaded resume file ─────────────────────────
router.post('/extract-text', upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) return res.status(400).json({ error: 'Unsupported file type' });

  const resumeText = await extractText(req.file);
  const needsOCR = ext === '.pdf' && !resumeText.trim();

  const aiResult = await analyzeWithAI('', resumeText, needsOCR ? req.file.buffer : null);
  if (aiResult.is_resume !== true) {
    return res.status(400).json({ error: 'Not a resume. Please upload a valid resume file.' });
  }

  res.json({ text: resumeText });
});

module.exports = router;