# SmartHire

AI-powered bulk resume screening tool that ranks candidates against a job description, verifies GitHub profiles, and exports shortlisted resumes in a uniform format.

🔗 **Live Demo:** https://accomplished-respect-production-12ef.up.railway.app/

---

## Features

- Bulk upload up to 100 resumes (PDF, DOCX, DOC, TXT)
- AI scoring — each resume ranked 0–100 against the job description using Groq LLM
- Strengths and skill gaps extracted per candidate
- GitHub verification — detects GitHub links, checks repo age, activity, and languages. Awards bonus points for verified profiles
- OCR support for image-based/scanned PDFs via pytesseract + pdf2image
- Garbage collector — non-resume files filtered out automatically
- Authentication — secure login via NextAuth.js (Google/GitHub OAuth) with PostgreSQL session storage
- Shortlist/remove candidates with one click
- Export CSV — full ranked list download
- Export PDF — shortlisted candidates exported as individual uniform PDFs, zipped together
- Rate limiting on bulk endpoints (10 requests / 15 min per IP)
- Dockerized AI service with all OCR dependencies pre-installed

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| Auth | NextAuth.js v4, @auth/pg-adapter (PostgreSQL sessions) |
| Backend | Node.js, Express v5, Multer, pdf-parse, mammoth, PDFKit |
| Security | Helmet, express-rate-limit |
| AI Service | FastAPI, Groq (llama-3.1-8b-instant), uvicorn |
| PDF & OCR | pdfplumber, pypdf, pytesseract, pdf2image, Pillow |
| PDF Generation | ReportLab, PyPDF |
| Database | PostgreSQL |
| Infrastructure | Docker, Railway |

---

## Architecture

\`\`\`
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js       │────▶│   Express.js    │────▶│   FastAPI       │
│   Frontend      │     │   Backend       │     │   AI Service    │
│   :3000         │     │   :8080         │     │   :8001         │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │   PostgreSQL    │
                        │   Database      │
                        └─────────────────┘
\`\`\`

---

## Migration: Flask → FastAPI

The AI service was originally built with Flask and later migrated to FastAPI for:

- **Async performance** — native async/await support for concurrent resume processing
- **Auto API docs** — Swagger UI available at /docs out of the box
- **Production-grade serving** — uvicorn ASGI server instead of Flask dev server
- **Better validation** — Pydantic models for request/response schemas

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

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL
- Groq API key — free at console.groq.com
- Tesseract OCR (brew install tesseract on Mac)
- Poppler (brew install poppler on Mac)

### Setup

1. Clone the repo

\`\`\`bash
git clone https://github.com/priyanshu859/smarthire.git
cd smarthire
\`\`\`

2. Backend

\`\`\`bash
cd backend && npm install && node index.js
\`\`\`

3. AI Service

\`\`\`bash
cd ai-service && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt && python main.py
\`\`\`

4. Frontend

\`\`\`bash
cd frontend && npm install && TURBOPACK=0 npm run dev
\`\`\`

5. Open http://localhost:3000

---

## Environment Variables

### Frontend
\`\`\`
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
\`\`\`

### Backend
\`\`\`
PORT=8080
DATABASE_URL=your_postgresql_url
FRONTEND_URL=http://localhost:3000
AI_SERVICE_URL=http://localhost:8001
GITHUB_TOKEN=your_github_token
\`\`\`

### AI Service
\`\`\`
PORT=8001
GROQ_API_KEY=your_groq_api_key
FRONTEND_URL=http://localhost:3000
\`\`\`

---

## Docker (AI Service)

\`\`\`bash
cd ai-service
docker build -t smarthire-ai .
docker run -p 8001:8001 --env-file .env smarthire-ai
\`\`\`

---

## Deployment

All three services are deployed on **Railway**:

- **Frontend** — Next.js (Root: /frontend)
- **Backend** — Express.js (Root: /backend)
- **AI Service** — FastAPI via Docker (Root: /ai-service)
- **PostgreSQL** — Railway managed database

---

Built by [Priyanshu Solanki](https://github.com/priyanshu859) · [LinkedIn](https://www.linkedin.com/in/priyanshusolanki-dev/)
