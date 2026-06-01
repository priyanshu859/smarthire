from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
import os
import json
import base64
import io
import zipfile
from datetime import datetime, timezone

import pytesseract
from pdf2image import convert_from_bytes
from PIL import Image

from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from pypdf import PdfWriter, PdfReader

load_dotenv()

app = Flask(__name__)
CORS(app)

client = Groq(api_key="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")


# ── OCR ───────────────────────────────────────────────────────────────────────
def extract_text_with_ocr(pdf_bytes):
    try:
        images = convert_from_bytes(pdf_bytes)
        text = ''
        for img in images:
            text += pytesseract.image_to_string(img)
        return text.strip()
    except Exception:
        return ''


# ── AI: analyze resume vs job description ─────────────────────────────────────
@app.route('/ai/analyze', methods=['POST'])
def analyze():
    data = request.json
    job_description = data.get('jobDescription', '')
    resume_text = data.get('resumeText', '')
    pdf_bytes = data.get('pdfBase64', None)

    if pdf_bytes:
        pdf_data = base64.b64decode(pdf_bytes)
        resume_text = extract_text_with_ocr(pdf_data)

    prompt = f"""
    You are an expert recruiter. Determine if the provided document is a resume/CV.

    Job Description: {job_description}
    Document Text: {resume_text if resume_text.strip() else "TEXT COULD NOT BE EXTRACTED - LIKELY AN IMAGE-BASED PDF"}

    Rules:
    - If text is empty or says "TEXT COULD NOT BE EXTRACTED", mark is_resume as true and give a score of 50
    - If text clearly shows it's NOT a resume (like a task list, article, report), mark is_resume as false
    - If it looks like a resume, analyze it properly

    Return ONLY a valid JSON object:
    - is_resume: boolean
    - match_score: integer 0-100
    - skill_gaps: array
    - strengths: array
    - summary: string

    No markdown, just JSON.
    """

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )

    result = json.loads(response.choices[0].message.content)
    return jsonify(result)


# ── AI: extract structured resume data ───────────────────────────────────────
def extract_resume_structure(resume_text: str) -> dict:
    prompt = f"""
You are a resume parser. Extract ALL content from this resume text into structured JSON.
Keep every single detail — do not summarize or skip anything.

Resume Text:
{resume_text}

Return ONLY a valid JSON object with these fields (use empty string or empty array if not found):
{{
  "full_name": "string",
  "email": "string",
  "phone": "string",
  "location": "string",
  "linkedin": "string",
  "github": "string",
  "website": "string",
  "summary": "string — full objective/summary paragraph",
  "education": [
    {{
      "degree": "string",
      "institution": "string",
      "year": "string",
      "grade": "string",
      "details": "string — any extra info"
    }}
  ],
  "experience": [
    {{
      "title": "string",
      "company": "string",
      "duration": "string",
      "location": "string",
      "points": ["string", "string"]
    }}
  ],
  "projects": [
    {{
      "name": "string",
      "tech": "string",
      "points": ["string", "string"],
      "link": "string"
    }}
  ],
  "skills": {{
    "languages": "string",
    "frameworks": "string",
    "tools": "string",
    "other": "string"
  }},
  "certifications": ["string"],
  "achievements": ["string"],
  "extra_sections": [
    {{
      "title": "string",
      "content": "string"
    }}
  ]
}}

No markdown, just JSON.
"""
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)


# ── ReportLab styles ──────────────────────────────────────────────────────────
def get_styles():
    PURPLE = colors.HexColor("#6d28d9")
    DARK   = colors.HexColor("#1a1a1a")
    MUTED  = colors.HexColor("#555555")
    LIGHT  = colors.HexColor("#888880")

    return {
        "name":     ParagraphStyle("name",     fontName="Helvetica-Bold",  fontSize=20, leading=24, textColor=DARK),
        "contact":  ParagraphStyle("contact",  fontName="Helvetica",       fontSize=8,  leading=12, textColor=LIGHT),
        "h1":       ParagraphStyle("h1",       fontName="Helvetica-Bold",  fontSize=10, leading=13, textColor=PURPLE, spaceBefore=6, spaceAfter=2),
        "body":     ParagraphStyle("body",     fontName="Helvetica",       fontSize=9,  leading=13, textColor=DARK),
        "bold":     ParagraphStyle("bold",     fontName="Helvetica-Bold",  fontSize=9,  leading=13, textColor=DARK),
        "muted":    ParagraphStyle("muted",    fontName="Helvetica",       fontSize=8,  leading=12, textColor=MUTED),
        "bullet":   ParagraphStyle("bullet",   fontName="Helvetica",       fontSize=9,  leading=13, textColor=DARK,   leftIndent=12),
        "small":    ParagraphStyle("small",    fontName="Helvetica",       fontSize=8,  leading=11, textColor=LIGHT),
    }


def hr(W):
    return HRFlowable(width=W, thickness=0.4, color=colors.HexColor("#e8e5de"), spaceAfter=4)


# ── Build one resume PDF from structured data ─────────────────────────────────

def s(val):
    """Safely convert None/any to stripped string."""
    return str(val).strip() if val is not None else ''

def build_resume_pdf(structured: dict, filename: str = "") -> bytes:
    buf = io.BytesIO()
    W = A4[0] - 4*cm

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm
    )

    S = get_styles()
    story = []

    # ── Header ────────────────────────────────────────────────────────────────
    name = structured.get("full_name") or filename.rsplit(".", 1)[0]
    story.append(Paragraph(name, S["name"]))
    story.append(Spacer(1, 3))

    contact_parts = []
    for field in ["email", "phone", "location", "linkedin", "github", "website"]:
        val = s(structured.get(field))
        if val:
            contact_parts.append(val)
    if contact_parts:
        story.append(Paragraph("  |  ".join(contact_parts), S["contact"]))
    story.append(Spacer(1, 6))
    story.append(hr(W))

    # ── Summary ───────────────────────────────────────────────────────────────
    summary = s(structured.get("summary"))
    if summary:
        story.append(Paragraph("PROFILE", S["h1"]))
        story.append(hr(W))
        story.append(Paragraph(summary, S["body"]))
        story.append(Spacer(1, 6))

    # ── Experience ────────────────────────────────────────────────────────────
    experience = structured.get("experience") or []
    if experience:
        story.append(Paragraph("EXPERIENCE", S["h1"]))
        story.append(hr(W))
        for exp in experience:
            title   = s(exp.get("title"))
            company = s(exp.get("company"))
            dur     = s(exp.get("duration"))
            loc     = s(exp.get("location"))

            left  = f"<b>{title}</b>" + (f" — {company}" if company else "")
            right_parts = []
            if dur: right_parts.append(dur)
            if loc: right_parts.append(loc)
            right = "  |  ".join(right_parts)

            story.append(Paragraph(left, S["bold"]))
            if right:
                story.append(Paragraph(right, S["muted"]))
            for pt in (exp.get("points") or []):
                if s(pt):
                    story.append(Paragraph(f"• {s(pt)}", S["bullet"]))
            story.append(Spacer(1, 5))

    # ── Projects ──────────────────────────────────────────────────────────────
    projects = structured.get("projects") or []
    if projects:
        story.append(Paragraph("PROJECTS", S["h1"]))
        story.append(hr(W))
        for proj in projects:
            pname = s(proj.get("name"))
            tech  = s(proj.get("tech"))
            link  = s(proj.get("link"))

            header = f"<b>{pname}</b>"
            if tech:  header += f" <font size='8' color='#888880'>({tech})</font>"
            if link:  header += f"  <font size='8' color='#6d28d9'>{link}</font>"
            story.append(Paragraph(header, S["bold"]))

            for pt in (proj.get("points") or []):
                if s(pt):
                    story.append(Paragraph(f"• {s(pt)}", S["bullet"]))
            story.append(Spacer(1, 5))

    # ── Education ─────────────────────────────────────────────────────────────
    education = structured.get("education") or []
    if education:
        story.append(Paragraph("EDUCATION", S["h1"]))
        story.append(hr(W))
        for edu in education:
            degree  = s(edu.get("degree"))
            inst    = s(edu.get("institution"))
            year    = s(edu.get("year"))
            grade   = s(edu.get("grade"))
            details = s(edu.get("details"))

            left  = f"<b>{degree}</b>" + (f" — {inst}" if inst else "")
            right_parts = []
            if year:  right_parts.append(year)
            if grade: right_parts.append(grade)

            story.append(Paragraph(left, S["bold"]))
            if right_parts:
                story.append(Paragraph("  |  ".join(right_parts), S["muted"]))
            if details:
                story.append(Paragraph(details, S["body"]))
            story.append(Spacer(1, 5))

    # ── Skills ────────────────────────────────────────────────────────────────
    skills = structured.get("skills") or {}
    if not isinstance(skills, dict): skills = {}
    skill_lines = []
    labels = [("Languages", "languages"), ("Frameworks", "frameworks"), ("Tools", "tools"), ("Other", "other")]
    for label, key in labels:
        val = s(skills.get(key))
        if val:
            skill_lines.append(f"<b>{label}:</b> {val}")
    if skill_lines:
        story.append(Paragraph("SKILLS", S["h1"]))
        story.append(hr(W))
        for line in skill_lines:
            story.append(Paragraph(line, S["body"]))
        story.append(Spacer(1, 5))

    # ── Certifications ────────────────────────────────────────────────────────
    certs = structured.get("certifications") or []
    if certs:
        story.append(Paragraph("CERTIFICATIONS", S["h1"]))
        story.append(hr(W))
        for c in certs:
            if s(c):
                story.append(Paragraph(f"• {s(c)}", S["bullet"]))
        story.append(Spacer(1, 5))

    # ── Achievements ──────────────────────────────────────────────────────────
    achievements = structured.get("achievements") or []
    if achievements:
        story.append(Paragraph("ACHIEVEMENTS", S["h1"]))
        story.append(hr(W))
        for a in achievements:
            if s(a):
                story.append(Paragraph(f"• {s(a)}", S["bullet"]))
        story.append(Spacer(1, 5))

    # ── Extra sections (clubs, languages spoken, etc.) ────────────────────────
    extras = structured.get("extra_sections") or []
    for section in extras:
        title   = s(section.get("title"))
        content = s(section.get("content"))
        if title and content:
            story.append(Paragraph(title.upper(), S["h1"]))
            story.append(hr(W))
            story.append(Paragraph(content, S["body"]))
            story.append(Spacer(1, 5))

    doc.build(story)
    buf.seek(0)
    return buf.read()


# ── Export endpoint ───────────────────────────────────────────────────────────
import time

@app.route('/ai/export-pdf', methods=['POST'])
def export_pdf():
    import traceback
    data = request.json
    candidates = data.get('candidates', [])

    if not candidates:
        return jsonify({'error': 'No candidates provided'}), 400

    zip_buf = io.BytesIO()

    try:
        with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for i, c in enumerate(candidates):
                if i > 0:
                    time.sleep(2)  # wait 2s between AI calls to avoid rate limit

                resume_text = c.get("resume_text", "") or ""

                try:
                    if resume_text and len(resume_text) > 100:
                        structured = extract_resume_structure(resume_text)
                    else:
                        raise ValueError("no resume text")
                except Exception as e:
                    print(f"AI parse failed for {c.get('filename')}: {e}, using fallback")
                    structured = {
                        "full_name":      c.get("filename", "").rsplit(".", 1)[0],
                        "email":          "",
                        "phone":          "",
                        "location":       "",
                        "linkedin":       "",
                        "github":         (c.get("github") or {}).get("username", "") or "",
                        "website":        "",
                        "summary":        c.get("summary", "") or "",
                        "education":      [],
                        "experience":     [],
                        "projects":       [],
                        "skills":         {"languages": "", "frameworks": "", "tools": "", "other": ""},
                        "certifications": [],
                        "achievements":   c.get("strengths") or [],
                        "extra_sections": []
                    }

                try:
                    pdf_bytes = build_resume_pdf(structured, c.get("filename", "candidate.pdf"))
                except Exception as e:
                    print(f"PDF build failed for {c.get('filename')}: {e}")
                    traceback.print_exc()
                    continue  # skip this candidate, don't crash entire export

                safe_name = c.get("filename", "candidate").rsplit(".", 1)[0]
                safe_name = "".join(ch if ch.isalnum() or ch in " _-" else "_" for ch in safe_name)
                zf.writestr(f"{safe_name}.pdf", pdf_bytes)

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

    zip_buf.seek(0)
    content = zip_buf.read()

    if len(content) < 100:
        return jsonify({'error': 'ZIP generation failed — no PDFs were created'}), 500

    return app.response_class(
        content,
        mimetype='application/zip',
        headers={'Content-Disposition': 'attachment; filename=shortlisted_resumes.zip'}
    )


if __name__ == '__main__':
    app.run(port=8001, debug=True)