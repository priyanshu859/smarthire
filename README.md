# SmartHire

AI-powered resume screening tool — bulk-rank candidates against a job description, verify GitHub profiles, and export shortlists. Also includes a seeker mode for individuals to get an ATS score on their resume.

🔗 **Live Demo:** [https://frontend-ashy-tau-57.vercel.app](https://frontend-ashy-tau-57.vercel.app)

---

## Features

**Recruiter Mode**
- Bulk upload up to 100 resumes (PDF, DOCX, DOC, TXT)
- AI scoring — each resume ranked 0–100 against the job description using Groq LLM
- Strengths and skill gaps extracted per candidate
- GitHub verification — detects GitHub links, checks repo age, activity, and languages; awards bonus points for verified profiles
- OCR support for image-based PDFs via pytesseract
- Garbage collector — non-resume files filtered out automatically
- Shortlist/remove candidates with one click
- Export CSV — full ranked list download
- Export PDF — shortlisted candidates exported as individual uniform PDFs, zipped together

**Seeker Mode**
- Upload your resume and get an instant ATS score
- Detailed breakdown visible after Google sign-in (freemium gating)
- Resume validation — non-resume files rejected automatically

---

## Tech Stack

| Layer          | Technologies                                    |
| -------------- | ----------------------------------------------- |
| Frontend       | Next.js, TypeScript, CSS Modules, NextAuth.js   |
| Backend        | Node.js, Express, Multer, pdf-parse, mammoth    |
| AI Service     | FastAPI, Python, Groq (llama-3.1-8b-instant)   |
| PDF Generation | ReportLab, PyPDF                                |
| OCR            | pytesseract, pdf2image                          |
| Database       | PostgreSQL (Neon)                               |
| Auth           | NextAuth.js + Google OAuth                      |

---

## Deployment

| Service     | Platform |
| ----------- | -------- |
| Frontend    | Vercel   |
| Backend     | Render   |
| AI Service  | Render (Docker) |
| Database    | Neon (PostgreSQL) |

---

## Local Setup

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL
- Groq API key — free at [console.groq.com](https://console.groq.com)
- tesseract installed (`brew install tesseract` on Mac)

### Environment Variables

**backend/.env**
```
DATABASE_URL=your_postgres_url
GROQ_API_KEY=your_groq_key
FRONTEND_URL=http://localhost:3000
AI_SERVICE_URL=http://localhost:8000
GITHUB_TOKEN=optional
```

**ai-service/.env**
```
GROQ_API_KEY=your_groq_key
FRONTEND_URL=http://localhost:3000
```

**frontend/.env.local**
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
NEXT_PUBLIC_AI_URL=http://localhost:8000
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
DATABASE_URL=your_postgres_url
```

### Run Locally

```bash
# Backend
cd backend && npm install && node index.js

# AI Service
cd ai-service && source venv/bin/activate && python3 main.py

# Frontend
cd frontend && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## GitHub Verification Logic

| Condition                    | Effect           |
| ---------------------------- | ---------------- |
| Repo created 8+ months ago   | Verified         |
| Active push in last 6 months | +10 bonus points |
| 2+ verified repos            | +10 bonus points |
| Has stars                    | +5 bonus points  |
| No GitHub link in resume     | Unverified badge |

---

Built by [Priyanshu Solanki](https://github.com/priyanshu859)
