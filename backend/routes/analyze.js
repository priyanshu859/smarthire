const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');

const upload = multer({ storage: multer.memoryStorage() });

async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.pdf') {
    try {
      const data = await pdfParse(file.buffer);
      return data.text || '';
    } catch {
      return '';
    }
  }

  if (ext === '.docx' || ext === '.doc') {
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return result.value || '';
    } catch (e) {
      return '';
    }
  }

  if (ext === '.txt') {
    return file.buffer.toString('utf-8');
  }

  return '';
}

function extractGithubUsername(text) {
  const match = text.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

async function checkGithub(username) {
  try {
    const res = await fetch(`https://api.github.com/users/${username}/repos?per_page=100`, {
      headers: { 'User-Agent': 'SmartHire-App' }
    });
    const repos = await res.json();
    if (!Array.isArray(repos)) return { verified: false, score: 0, details: 'No repos found' };

    const now = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(now.getMonth() - 8);

    const validRepos = repos.filter(r => {
      const created = new Date(r.created_at);
      return created <= eightMonthsAgo && !r.fork;
    });

    const recentlyActive = repos.filter(r => {
      const pushed = new Date(r.pushed_at);
      return pushed >= sixMonthsAgo;
    });

    const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
    const languages = [...new Set(repos.map(r => r.language).filter(Boolean))];

    let bonusScore = 0;
    if (totalStars > 0) bonusScore += 5;
    if (totalStars > 10) bonusScore += 5;
    if (recentlyActive.length > 0) bonusScore += 10;
    if (validRepos.length >= 2) bonusScore += 10;

    return {
      verified: validRepos.length > 0,
      score: bonusScore,
      details: {
        totalRepos: repos.length,
        validRepos: validRepos.length,
        recentlyActive: recentlyActive.length,
        totalStars,
        languages
      }
    };
  } catch (err) {
    return { verified: false, score: 0, details: 'GitHub check failed' };
  }
}

async function analyzeWithAI(jobDescription, resumeText, pdfBuffer) {
  const payload = {
    jobDescription,
    resumeText,
    pdfBase64: pdfBuffer ? pdfBuffer.toString('base64') : null
  };

  const res = await fetch('http://localhost:8001/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

router.post('/analyze-bulk', upload.array('resumes', 100), async (req, res) => {
  const { jobDescription } = req.body;
  if (!jobDescription) return res.status(400).json({ error: 'Job description required' });
  if (!req.files?.length) return res.status(400).json({ error: 'No resumes uploaded' });

  try {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const results = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      if (i > 0) await sleep(1500); // 1.5s gap between each — stays under 12k TPM
      const result = await (async (file) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowed = ['.pdf', '.doc', '.docx', '.txt'];

        if (!allowed.includes(ext)) {
          return {
            filename: file.originalname,
            is_resume: false,
            match_score: 0,
            strengths: [],
            skill_gaps: [],
            summary: 'Unsupported file type',
            resume_text: '',
            github: { username: null, verified: false, details: 'N/A' },
            shortlisted: false
          };
        }

        const resumeText = await extractText(file);
        const needsOCR = ext === '.pdf' && !resumeText.trim();
        const aiResult = await analyzeWithAI(
          jobDescription,
          resumeText,
          needsOCR ? file.buffer : null
        );

        const githubUsername = extractGithubUsername(resumeText);
        let githubData = { verified: false, score: 0, details: 'No GitHub link found' };
        if (githubUsername) {
          githubData = await checkGithub(githubUsername);
        }

        const finalScore = Math.min(100, (aiResult.match_score || 0) + githubData.score);
        const shortlisted = finalScore >= 70;

        await pool.query(
          'INSERT INTO analyses (job_description, resume_text, match_score, skill_gaps) VALUES ($1, $2, $3, $4)',
          [jobDescription, resumeText.slice(0, 5000), finalScore, aiResult.skill_gaps]
        );

        return {
          filename: file.originalname,
          ...aiResult,
          match_score: finalScore,
          shortlisted,
          resume_text: resumeText.slice(0, 8000), // ← send full text to frontend for PDF export
          github: {
            username: githubUsername,
            verified: githubData.verified,
            details: githubData.details
          }
        };
      })(file);
      results.push(result);
    }

    results.sort((a, b) => b.match_score - a.match_score);
    res.json({ candidates: results, total: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;