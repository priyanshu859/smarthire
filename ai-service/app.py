from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
import os, json, base64, io, zipfile, time, traceback

import pytesseract
from pdf2image import convert_from_bytes

from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors

load_dotenv()
app = Flask(__name__)
CORS(app)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

MODEL = "llama-3.1-8b-instant"


# ── OCR ────────────────────────────────────────────────────────────────────
def extract_text_with_ocr(pdf_bytes: bytes) -> str:
    try:
        return "\n".join(pytesseract.image_to_string(img) for img in convert_from_bytes(pdf_bytes)).strip()
    except Exception:
        return ""


# ── Groq helper ────────────────────────────────────────────────────────────
def groq_json(prompt: str) -> dict:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)


# ── Safe string ────────────────────────────────────────────────────────────
def s(val) -> str:
    return str(val).strip() if val is not None else ""


# ── Analyze endpoint ───────────────────────────────────────────────────────
@app.route("/ai/analyze", methods=["POST"])
def analyze():
    data = request.json
    job_description = data.get("jobDescription", "")
    resume_text = data.get("resumeText", "")
    pdf_b64 = data.get("pdfBase64")

    if pdf_b64:
        resume_text = extract_text_with_ocr(base64.b64decode(pdf_b64))

    doc_text = resume_text.strip() or "TEXT COULD NOT BE EXTRACTED - LIKELY AN IMAGE-BASED PDF"

    prompt = f"""You are an expert recruiter. Decide if the document is a resume/CV.

Job Description:
{job_description}

Document Text:
{doc_text}

STEP 1 — IS THIS A RESUME?
Mark is_resume as FALSE immediately if the document is any of:
- A study plan, grind plan, learning roadmap, or weekly schedule
  (contains phrases like "Week 1", "Day 1", "hrs/day", "Daily Schedule",
   "10-Week", "phase 1", "time block", "LPA target", "roadmap", "grind plan")
- A task list, to-do list, or project plan
- An article, blog post, research paper, invoice, or report
- Any document describing a PLAN or SCHEDULE rather than a PERSON's background

Mark is_resume as TRUE only if ALL of these are present:
- A person's name
- Contact info (email or phone)
- At least one of: work experience, education, or skills section

If text is empty or unreadable: is_resume=true, score=50.

STEP 2 — If is_resume is true, score it against the job description.

CRITICAL JSON RULES:
- Double quotes only — NO apostrophes inside strings (write "candidates background" not "candidate's background")
- No newlines inside string values
- summary = one plain sentence, no special characters

Return ONLY this JSON, nothing else:
{{
  "is_resume": true or false,
  "match_score": integer 0-100,
  "skill_gaps": ["string"],
  "strengths": ["string"],
  "summary": "one plain sentence"
}}"""

    try:
        result = groq_json(prompt)
    except Exception as e:
        print(f"Groq analyze error: {e}")
        result = {"is_resume": True, "match_score": 50, "skill_gaps": [], "strengths": [],
                  "summary": "Could not analyze — please review manually."}

    result.setdefault("is_resume", True)
    result.setdefault("match_score", 0)
    result.setdefault("skill_gaps", [])
    result.setdefault("strengths", [])
    result.setdefault("summary", "")
    return jsonify(result)


# ── Resume structure extraction ────────────────────────────────────────────
def extract_resume_structure(resume_text: str) -> dict:
    prompt = f"""You are a resume parser. Extract ALL content from this resume into structured JSON.
Keep every detail — do not summarize or skip anything.

Resume Text:
{resume_text}

CRITICAL JSON RULES:
- Double quotes only — NO apostrophes inside strings
- No newlines inside string values

Return ONLY this JSON (empty string or [] if not found):
{{
  "full_name": "", "email": "", "phone": "", "location": "",
  "linkedin": "", "github": "", "website": "", "summary": "",
  "education": [{{"degree":"","institution":"","year":"","grade":"","details":""}}],
  "experience": [{{"title":"","company":"","duration":"","location":"","points":[""]}}],
  "projects": [{{"name":"","tech":"","points":[""],"link":""}}],
  "skills": {{"languages":"","frameworks":"","tools":"","other":""}},
  "certifications": [""],
  "achievements": [""],
  "extra_sections": [{{"title":"","content":""}}]
}}"""
    return groq_json(prompt)


# ── Colors ─────────────────────────────────────────────────────────────────
DARK   = colors.HexColor("#1a1a1a")
PURPLE = colors.HexColor("#6d28d9")
MUTED  = colors.HexColor("#555555")
SIDEBAR= colors.HexColor("#f8f7ff")
BORDER = colors.HexColor("#e8e5de")


# ── PDF builder ────────────────────────────────────────────────────────────
def build_resume_pdf(structured: dict, filename: str = "") -> bytes:
    buf = io.BytesIO()
    PAGE_W, _ = A4
    MARGIN  = 1.5 * cm
    LEFT_W  = 6 * cm
    RIGHT_W = PAGE_W - LEFT_W - 2 * MARGIN

    doc = SimpleDocTemplate(buf, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN)

    def style(name, **kw):
        return ParagraphStyle(name, **kw)

    ST = {
        "name":   style("name",  fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=DARK),
        "sh":     style("sh",    fontName="Helvetica-Bold", fontSize=8,  leading=11, textColor=PURPLE, spaceBefore=10, spaceAfter=3),
        "sb":     style("sb",    fontName="Helvetica",      fontSize=8,  leading=12, textColor=DARK),
        "ss":     style("ss",    fontName="Helvetica",      fontSize=7,  leading=10, textColor=MUTED),
        "mh":     style("mh",    fontName="Helvetica-Bold", fontSize=9,  leading=12, textColor=PURPLE, spaceBefore=8, spaceAfter=2),
        "mbold":  style("mbold", fontName="Helvetica-Bold", fontSize=9,  leading=13, textColor=DARK),
        "mbody":  style("mbody", fontName="Helvetica",      fontSize=8.5,leading=13, textColor=DARK),
        "mmuted": style("mmuted",fontName="Helvetica",      fontSize=8,  leading=11, textColor=MUTED),
        "bull":   style("bull",  fontName="Helvetica",      fontSize=8.5,leading=13, textColor=DARK, leftIndent=10),
    }

    c   = structured
    B   = "•"
    hr  = lambda w: HRFlowable(width=w, thickness=0.3, color=BORDER)
    hrp = lambda w: HRFlowable(width=w, thickness=0.4, color=PURPLE, spaceAfter=4)

    # ── Sidebar ────────────────────────────────────────────────────────────
    left = []
    left += [Paragraph("CONTACT", ST["sh"]), hr(LEFT_W - 0.4*cm), Spacer(1, 3)]
    for field in ["email", "phone", "location", "linkedin", "github", "website"]:
        if v := s(c.get(field)):
            left += [Paragraph(v, ST["ss"]), Spacer(1, 2)]

    skills = c.get("skills") or {}
    if not isinstance(skills, dict): skills = {}
    if any(s(skills.get(k)) for k in ["languages","frameworks","tools","other"]):
        left += [Paragraph("SKILLS", ST["sh"]), hr(LEFT_W - 0.4*cm), Spacer(1, 3)]
        for label, key in [("Languages","languages"),("Frameworks","frameworks"),("Tools","tools"),("Other","other")]:
            if v := s(skills.get(key)):
                left += [Paragraph(f"<b>{label}</b>", ST["sb"]), Paragraph(v, ST["ss"]), Spacer(1, 4)]

    if edu_list := c.get("education") or []:
        left += [Paragraph("EDUCATION", ST["sh"]), hr(LEFT_W - 0.4*cm), Spacer(1, 3)]
        for edu in edu_list:
            if deg := s(edu.get("degree")): left.append(Paragraph(f"<b>{deg}</b>", ST["sb"]))
            if ins := s(edu.get("institution")): left.append(Paragraph(ins, ST["ss"]))
            yr = "  |  ".join(filter(None, [s(edu.get("year")), s(edu.get("grade"))]))
            if yr: left.append(Paragraph(yr, ST["ss"]))
            left.append(Spacer(1, 5))

    if certs := c.get("certifications") or []:
        left += [Paragraph("CERTIFICATIONS", ST["sh"]), hr(LEFT_W - 0.4*cm), Spacer(1, 3)]
        for cert in certs:
            if v := s(cert): left += [Paragraph(f"{B} {v}", ST["ss"]), Spacer(1, 2)]

    # ── Main content ───────────────────────────────────────────────────────
    right = []
    name = s(c.get("full_name")) or filename.rsplit(".", 1)[0]
    right += [Paragraph(name, ST["name"]), Spacer(1, 2)]

    if summ := s(c.get("summary")):
        right += [Paragraph("PROFILE", ST["mh"]), hrp(RIGHT_W), Paragraph(summ, ST["mbody"]), Spacer(1, 4)]

    if exps := c.get("experience") or []:
        right += [Paragraph("EXPERIENCE", ST["mh"]), hrp(RIGHT_W)]
        for exp in exps:
            title   = s(exp.get("title"))
            company = s(exp.get("company"))
            dur     = s(exp.get("duration"))
            loc     = s(exp.get("location"))
            left_t  = f"<b>{title}</b>" + (f" — {company}" if company else "")
            right_t = "  |  ".join(filter(None, [dur, loc]))
            t = Table([[Paragraph(left_t, ST["mbold"]), Paragraph(right_t, ST["mmuted"])]],
                      colWidths=[RIGHT_W * 0.65, RIGHT_W * 0.35])
            t.setStyle(TableStyle([
                ("ALIGN",(1,0),(1,0),"RIGHT"),("VALIGN",(0,0),(-1,-1),"TOP"),
                ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
                ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),2),
            ]))
            right.append(t)
            for pt in (exp.get("points") or []):
                if v := s(pt): right.append(Paragraph(f"{B} {v}", ST["bull"]))
            right.append(Spacer(1, 5))

    if projs := c.get("projects") or []:
        right += [Paragraph("PROJECTS", ST["mh"]), hrp(RIGHT_W)]
        for proj in projs:
            pname = s(proj.get("name"))
            tech  = s(proj.get("tech"))
            link  = s(proj.get("link"))
            hdr   = f"<b>{pname}</b>"
            if tech: hdr += f" <font size='7' color='#888880'>({tech})</font>"
            if link: hdr += f"  <font size='7' color='#6d28d9'>{link}</font>"
            right.append(Paragraph(hdr, ST["mbold"]))
            for pt in (proj.get("points") or []):
                if v := s(pt): right.append(Paragraph(f"{B} {v}", ST["bull"]))
            right.append(Spacer(1, 5))

    if achvs := c.get("achievements") or []:
        right += [Paragraph("ACHIEVEMENTS", ST["mh"]), hrp(RIGHT_W)]
        for a in achvs:
            if v := s(a): right.append(Paragraph(f"{B} {v}", ST["bull"]))
        right.append(Spacer(1, 4))

    for sec in (c.get("extra_sections") or []):
        if (title := s(sec.get("title"))) and (content := s(sec.get("content"))):
            right += [Paragraph(title.upper(), ST["mh"]), hrp(RIGHT_W),
                      Paragraph(content, ST["mbody"]), Spacer(1, 4)]

    # ── Layout ────────────────────────────────────────────────────────────
    def wrap(content, width, bg=None, lpad=8, tpad=8):
        t = Table([[ content ]], colWidths=[width])
        styles_list = [
            ("VALIGN",(0,0),(-1,-1),"TOP"),
            ("LEFTPADDING",(0,0),(-1,-1),lpad),
            ("RIGHTPADDING",(0,0),(-1,-1),lpad),
            ("TOPPADDING",(0,0),(-1,-1),tpad),
            ("BOTTOMPADDING",(0,0),(-1,-1),tpad),
        ]
        if bg: styles_list.append(("BACKGROUND",(0,0),(-1,-1),bg))
        t.setStyle(TableStyle(styles_list))
        return t

    layout = Table(
        [[wrap(left, LEFT_W, bg=SIDEBAR), wrap(right, RIGHT_W, lpad=12)]],
        colWidths=[LEFT_W + 0.4*cm, RIGHT_W + 0.8*cm]
    )
    layout.setStyle(TableStyle([
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
        ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0),
        ("LINEAFTER",(0,0),(0,-1),0.5,BORDER),
    ]))

    doc.build([layout])
    buf.seek(0)
    return buf.read()


# ── Export endpoint ────────────────────────────────────────────────────────
@app.route("/ai/export-pdf", methods=["POST"])
def export_pdf():
    candidates = request.json.get("candidates", [])
    if not candidates:
        return jsonify({"error": "No candidates provided"}), 400

    zip_buf = io.BytesIO()
    try:
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, c in enumerate(candidates):
                if i > 0:
                    time.sleep(2)
                resume_text = c.get("resume_text") or ""
                try:
                    structured = extract_resume_structure(resume_text) if len(resume_text) > 100 else None
                    if not structured: raise ValueError("no text")
                except Exception as e:
                    print(f"AI parse failed for {c.get('filename')}: {e} — using fallback")
                    structured = {
                        "full_name": c.get("filename", "").rsplit(".", 1)[0],
                        "email": "", "phone": "", "location": "",
                        "linkedin": "", "github": (c.get("github") or {}).get("username", "") or "",
                        "website": "", "summary": c.get("summary", "") or "",
                        "education": [], "experience": [], "projects": [],
                        "skills": {"languages": "", "frameworks": "", "tools": "", "other": ""},
                        "certifications": [], "achievements": c.get("strengths") or [],
                        "extra_sections": []
                    }
                try:
                    pdf_bytes = build_resume_pdf(structured, c.get("filename", "candidate.pdf"))
                except Exception as e:
                    print(f"PDF build failed for {c.get('filename')}: {e}")
                    traceback.print_exc()
                    continue

                safe = "".join(ch if ch.isalnum() or ch in " _-" else "_"
                               for ch in c.get("filename", "candidate").rsplit(".", 1)[0])
                zf.writestr(f"{safe}.pdf", pdf_bytes)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

    zip_buf.seek(0)
    content = zip_buf.read()
    if len(content) < 100:
        return jsonify({"error": "ZIP generation failed"}), 500

    return app.response_class(
        content, mimetype="application/zip",
        headers={"Content-Disposition": "attachment; filename=shortlisted_resumes.zip"}
    )


if __name__ == "__main__":
    app.run(port=8001, debug=True)