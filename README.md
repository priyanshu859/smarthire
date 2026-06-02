# SmartHire

AI-powered bulk resume screening tool that ranks candidates against a job description, verifies GitHub profiles, and exports shortlisted resumes in a uniform format.

---

## Features

- Bulk upload up to 100 resumes (PDF, DOCX, DOC, TXT)
- AI scoring — each resume ranked 0-100 against the job description using Groq LLM
- Strengths and skill gaps extracted per candidate
- GitHub verification — detects GitHub links, checks repo age, activity, and languages. Awards bonus points for verified profiles
- OCR support for image-based PDFs via pytesseract
- Garbage collector — non-resume files filtered out automatically
- Shortlist/remove candidates with one click
- Export CSV — full ranked list download
- Export PDF — shortlisted candidates exported as individual uniform PDFs, zipped together

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Next.js, TypeScript, CSS Modules |
| Backend | Node.js, Express, Multer, pdf-parse, mammoth |
| AI Service | Flask, Groq (llama-3.1-8b-instant) |
| PDF Generation | ReportLab, PyPDF |
| OCR | pytesseract, pdf2image |
| Database | PostgreSQL |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL
- Groq API key — free at console.groq.com
- tesseract installed (brew install tesseract on Mac)

### Setup

1. Clone the repo and install dependencies
2. Create backend/.env with DATABASE_URL
3. Create ai-service/.env with GROQ_API_KEY
4. Run backend: cd backend && npm install && node index.js
5. Run AI service: cd ai-service && source venv/bin/activate && python3 app.py
6. Run frontend: cd frontend && npm install && npm run dev
7. Open http://localhost:3000

---

## GitHub Verification Logic

| Condition | Effect |
|-----------|--------|
| Repo created 8+ months ago | Verified |
| Active push in last 6 months | +10 bonus points |
| 2+ verified repos | +10 bonus points |
| Has stars | +5 bonus points |
| No GitHub link in resume | Unverified badge |

---

Built by [Priyanshu Solanki](https://github.com/priyanshu859)
