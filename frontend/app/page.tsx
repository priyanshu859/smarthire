'use client';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useState, useEffect } from 'react';
import styles from './page.module.css';

interface GitHubDetails {
  totalRepos: number;
  validRepos: number;
  recentlyActive: number;
  totalStars: number;
  languages: string[];
}

interface Candidate {
  filename: string;
  match_score: number;
  strengths: string[];
  skill_gaps: string[];
  summary: string;
  is_resume: boolean;
  shortlisted: boolean;
  github: {
    username: string | null;
    verified: boolean;
    details: GitHubDetails | string;
  };
}

const Footer = ({ centered = false }: { centered?: boolean }) => (
  <footer className={centered ? styles.footerCentered : styles.footer}>
    {!centered && (
      <div className={styles.footerLeft}>
        <span className={styles.footerBrand}>Smart<span>Hire</span></span>
        <span className={styles.footerTagline}>AI-powered bulk resume screener</span>
      </div>
    )}
    <div className={styles.footerRight}>
      <span>Developed by : Priyanshu Solanki</span>
      <span className={styles.footerDot}>·</span>
      <a href="https://github.com/priyanshu850" target="_blank" rel="noreferrer">GitHub</a>
      <a href="https://linkedin.com/in/priyanshu-solanki" target="_blank" rel="noreferrer">LinkedIn</a>
    </div>
  </footer>
);

export default function Home() {
  const { data: session } = useSession();
  const [mode, setMode] = useState<'hirer' | 'seeker'>('hirer');
  const [jobDescription, setJobDescription] = useState('');
  const [resumes, setResumes] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [garbage, setGarbage] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const [analyzed, setAnalyzed] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showNotShortlisted, setShowNotShortlisted] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const [seekerJD, setSeekerJD] = useState('');
  const [seekerInputMode, setSeekerInputMode] = useState<'file' | 'text'>('file');
  const [seekerResumeFile, setSeekerResumeFile] = useState<File | null>(null);
  const [seekerResumeText, setSeekerResumeText] = useState('');
  const [seekerLoading, setSeekerLoading] = useState(false);
  const [seekerError, setSeekerError] = useState('');
  const [seekerResult, setSeekerResult] = useState<any>(null);

  useEffect(() => {
    if (!seekerResult) return;
    const loadChart = () => {
      const canvas = document.getElementById('atsDonut') as HTMLCanvasElement;
      if (!canvas) return;
      if ((window as any).Chart) {
        new (window as any).Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: ['Skills', 'Experience', 'Keywords'],
            datasets: [{
              data: [
                seekerResult.breakdown?.skills_match,
                seekerResult.breakdown?.experience_match,
                seekerResult.breakdown?.keyword_match,
              ],
              backgroundColor: ['#6d28d9', '#7c3aed', '#8b5cf6'],
              borderWidth: 0,
              hoverOffset: 4,
            }],
          },
          options: {
            responsive: false,
            cutout: '72%',
            plugins: { legend: { display: false } },
          },
        });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      script.onload = loadChart;
      document.head.appendChild(script);
    };
    setTimeout(loadChart, 100);
  }, [seekerResult]);

  useEffect(() => {
  const pending = localStorage.getItem('pendingAtsResult');
  if (pending) {
    setSeekerResult(JSON.parse(pending));
    setSeekerJD(localStorage.getItem('pendingAtsJD') || '');
    setMode('seeker');
    localStorage.removeItem('pendingAtsResult');
    localStorage.removeItem('pendingAtsJD');
  }
}, []);

  const handleAnalyze = async () => {
    if (!jobDescription || !resumes?.length) {
      setError('Please fill job description and upload resumes');
      return;
    }
    setLoading(true);
    setError('');
    const formData = new FormData();
    formData.append('jobDescription', jobDescription);
    Array.from(resumes).forEach(file => formData.append('resumes', file));
    try {
      const res = await fetch('http://localhost:8080/api/analyze-bulk', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      const valid = data.candidates.filter((c: any) => c.is_resume !== false);
      const invalid = data.candidates.filter((c: any) => c.is_resume === false);
      setCandidates(valid);
      setGarbage(invalid);
      setAnalyzed(true);
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleShortlist = (index: number) => {
    setCandidates(prev => prev.map((c, i) =>
      i === index ? { ...c, shortlisted: !c.shortlisted } : c
    ));
  };

  const handleExportPDF = async () => {
    const shortlisted = candidates.filter(c => c.shortlisted);
    if (shortlisted.length === 0) return;
    setExportLoading(true);
    try {
      const res = await fetch('http://localhost:8001/ai/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: shortlisted }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shortlisted_resumes.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Export failed: ' + (err.message || 'Make sure the AI service is running on port 8001.'));
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportCSV = () => {
    const rows = [
      ['Filename', 'Match Score', 'Shortlisted', 'Strengths', 'Skill Gaps', 'Summary', 'GitHub', 'GitHub Verified'],
      ...candidates.map(c => [
        c.filename,
        c.match_score,
        c.shortlisted ? 'Yes' : 'No',
        (c.strengths || []).join('; '),
        (c.skill_gaps || []).join('; '),
        c.summary,
        c.github?.username || '',
        c.github?.verified ? 'Yes' : 'No',
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smarthire_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getScoreClass = (score: number) => {
    if (score >= 75) return styles.scHigh;
    if (score >= 50) return styles.scMid;
    return styles.scLow;
  };

  const cleanName = (filename: string) =>
    filename.replace(/\.(pdf|docx|doc|txt)$/i, '');

  const handleCheckATS = async () => {
    if (seekerInputMode === 'file' && !seekerResumeFile) {
      setSeekerError('Please upload your resume');
      return;
    }
    if (seekerInputMode === 'text' && !seekerResumeText.trim()) {
      setSeekerError('Please paste your resume text');
      return;
    }
    setSeekerError('');
    setSeekerLoading(true);
    try {
      let resumeText = seekerResumeText;
      if (seekerInputMode === 'file' && seekerResumeFile) {
        const formData = new FormData();
        formData.append('resume', seekerResumeFile);
        const extractRes = await fetch('http://localhost:8080/api/extract-text', {
          method: 'POST',
          body: formData,
        });
        const extractData = await extractRes.json();
        if (extractData.error) throw new Error(extractData.error);
        if (!extractData.text) throw new Error('Could not extract text from file');
        resumeText = extractData.text;
      }
      const validateRes = await fetch('http://localhost:8001/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jobDescription: '' }),
      });
      const validateData = await validateRes.json();
      if (validateData.is_resume === false) {
        throw new Error('This file does not appear to be a resume. Please upload a valid resume.');
      }
      const atsRes = await fetch('http://localhost:8001/ats/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jobDescription: seekerJD || undefined }),
      });
      const atsData = await atsRes.json();
      setSeekerResult(atsData);
      localStorage.setItem('pendingAtsResult', JSON.stringify(atsData));
      localStorage.setItem('pendingAtsJD', seekerJD);
    } catch (err: any) {
      setSeekerError(err.message || 'Something went wrong. Try again.');
    } finally {
      setSeekerLoading(false);
    }
  };

  const AuthButton = () => session ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <img src={session.user?.image || ''} style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
      <span style={{ fontSize: '13px' }}>{session.user?.name}</span>
      <button className={styles.tbtn} onClick={() => signOut()}>Sign out</button>
    </div>
  ) : (
  <button className={styles.tbtn} onClick={() => {
    if (seekerResult) {
      localStorage.setItem('pendingAtsResult', JSON.stringify(seekerResult));
      localStorage.setItem('pendingAtsJD', seekerJD);
    }
    signIn('google');
  }}>Sign in</button>
);

  const ModeToggle = () => (
    <div className={styles.modeToggle}>
      <button
        className={mode === 'hirer' ? styles.modeBtnActive : styles.modeBtn}
        onClick={() => setMode('hirer')}
      >
        Hirer
      </button>
      <button
        className={mode === 'seeker' ? styles.modeBtnActive : styles.modeBtn}
        onClick={() => setMode('seeker')}
      >
        Job Seeker
      </button>
    </div>
  );

  const GitHubBadge = ({ c, index }: { c: Candidate; index: number }) => {
    const isOpen = expandedRow === index;
    const verified = c.github?.verified;
    const hasGitHub = !!c.github?.username;

    const renderDetails = () => {
      const d = c.github.details;
      if (typeof d === 'string') return <span className={styles.githubDetailLine}>{d}</span>;
      const lines: string[] = [];
      if (d.validRepos === 0) lines.push('No repos older than 6 months');
      else lines.push(d.validRepos + ' repo(s) older than 6 months');
      if (d.recentlyActive === 0) lines.push('No activity in last 6 months');
      else lines.push(d.recentlyActive + ' active in last 6 months');
      lines.push(d.totalStars + ' total stars');
      if (d.languages.length > 0) lines.push('Languages: ' + d.languages.join(', '));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {lines.map((l, i) => <span key={i} className={styles.githubDetailLine}>{l}</span>)}
        </div>
      );
    };

    return (
      <div className={styles.githubWrapper}>
        <button
          className={verified ? styles.badgeVerified : styles.badgeUnverified}
          onClick={() => setExpandedRow(isOpen ? null : index)}
        >
          {verified ? 'Verified' : 'Unverified'}
        </button>
        {isOpen && (
          <div className={styles.githubDropdown}>
            {hasGitHub && (
              <span className={styles.githubLink} onClick={() => window.open('https://github.com/' + c.github.username, '_blank')}>
                {'github.com/' + c.github.username}
              </span>
            )}
            {hasGitHub ? renderDetails() : <span className={styles.githubDetailLine}>No GitHub link found in resume</span>}
          </div>
        )}
      </div>
    );
  };

  const CandidateCard = ({ c, globalIndex, rank }: { c: Candidate; globalIndex: number; rank: number }) => (
    <div className={`${styles.ccard} ${rank === 1 ? styles.topCard : ''}`}>
      <span className={styles.rankNum}>{'#' + rank}</span>
      <div className={styles.cbody}>
        <div className={styles.crow1}>
          <span className={styles.cname}>{cleanName(c.filename)}</span>
          <span className={`${styles.cscore} ${getScoreClass(c.match_score)}`}>{c.match_score}%</span>
          <GitHubBadge c={c} index={globalIndex} />
        </div>
        <div className={styles.tags}>
          {(c.strengths || []).slice(0, 4).map((s, i) => (
            <span key={i} className={styles.tag}>{String(s)}</span>
          ))}
          {(c.skill_gaps || []).slice(0, 3).map((s, i) => (
            <span key={'g' + i} className={`${styles.tag} ${styles.tagGap}`}>{String(s)}</span>
          ))}
        </div>
        <p className={styles.csummary}>{c.summary}</p>
      </div>
      <div className={styles.cright}>
        <button
          className={c.shortlisted ? styles.btnRemove : styles.btnShortlist}
          onClick={() => toggleShortlist(globalIndex)}
        >
          {c.shortlisted ? 'Remove' : 'Shortlist'}
        </button>
      </div>
    </div>
  );

  if (mode === 'seeker') {
    if (seekerResult) {
      const score = seekerResult.match_score;
      const scoreColor = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
      return (
        <div className={styles.wrap}>
          <div className={styles.topbar}>
            <span className={styles.brand}>Smart<span>Hire</span></span>
            <ModeToggle />
            <div style={{ marginLeft: 'auto' }}><AuthButton /></div>
          </div>
          <div className={styles.content}>
            <button
              onClick={() => setSeekerResult(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary, #888)', background: 'none', border: '0.5px solid #e8e5de', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', marginBottom: '2rem' }}
            >
              ← Check another resume
            </button>

            {/* Top grid — donut + score only (always visible) */}
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '24px', marginBottom: '24px', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: '200px', height: '200px' }}>
                <canvas id="atsDonut" role="img" aria-label={`ATS score ${score} out of 100`} style={{ width: '100%', height: '100%' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                  <div style={{ fontSize: '40px', fontWeight: 500, color: scoreColor, lineHeight: 1 }}>{score}</div>
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{seekerJD ? 'JD match score' : 'Resume quality score'}<br />/ 100</div>
                </div>
              </div>

              {/* Breakdown bars — login required */}
              {session ? (
                <div style={{ background: 'var(--color-background-primary, #fff)', border: '0.5px solid #e8e5de', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                  {[
                    { label: 'Skills', value: seekerResult.breakdown?.skills_match },
                    { label: 'Experience', value: seekerResult.breakdown?.experience_match },
                    { label: 'Keywords', value: seekerResult.breakdown?.keyword_match },
                  ].map(({ label, value }, i) => (
                    <div key={label} style={{ marginBottom: i < 2 ? '14px' : 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                        <span>{label}</span><span>{value}%</span>
                      </div>
                      <div style={{ height: '6px', background: '#e8e5de', borderRadius: '99px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${value}%`, background: '#6d28d9', borderRadius: '99px' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '2rem', background: '#f0edff', borderRadius: '12px' }}>
                  <p style={{ fontSize: '15px', color: '#3b1f8c', marginBottom: '16px' }}>
                    Sign in to see detailed breakdown, keyword analysis & bullet rewrites
                  </p>
                  <button className={styles.btn} onClick={() => signIn('google')} style={{ width: 'auto', padding: '10px 28px' }}>
                    Sign in with Google
                  </button>
                </div>
              )}
            </div>

            {/* Keywords, bullet rewrites, summary — login required */}
            {session && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                  {seekerResult.matched_keywords?.length > 0 && (
                    <div style={{ background: 'var(--color-background-primary, #fff)', border: '0.5px solid #e8e5de', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                      <div style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '10px' }}>Matched keywords</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {seekerResult.matched_keywords.map((k: string) => (
                          <span key={k} style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: '99px', fontSize: '12px' }}>{k}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {seekerResult.missing_keywords?.length > 0 && (
                    <div style={{ background: 'var(--color-background-primary, #fff)', border: '0.5px solid #e8e5de', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                      <div style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '10px' }}>Missing keywords</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {seekerResult.missing_keywords.map((k: string) => (
                          <span key={k} style={{ background: '#fee2e2', color: '#991b1b', padding: '3px 10px', borderRadius: '99px', fontSize: '12px' }}>{k}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {seekerResult.bullet_rewrites?.length > 0 && (
                  <div style={{ background: 'var(--color-background-primary, #fff)', border: '0.5px solid #e8e5de', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '24px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '14px' }}>Bullet rewrites</div>
                    {seekerResult.bullet_rewrites.map((b: any, i: number) => (
                      <div key={i} style={{ marginBottom: i < seekerResult.bullet_rewrites.length - 1 ? '16px' : 0, paddingBottom: i < seekerResult.bullet_rewrites.length - 1 ? '16px' : 0, borderBottom: i < seekerResult.bullet_rewrites.length - 1 ? '0.5px solid #e8e5de' : 'none' }}>
                        <div style={{ fontSize: '13px', color: '#888', textDecoration: 'line-through', marginBottom: '8px' }}>{b.original}</div>
                        <div style={{ fontSize: '13px', lineHeight: 1.6 }}><span style={{ color: '#6d28d9', marginRight: '6px' }}>✦</span>{b.improved}</div>
                      </div>
                    ))}
                  </div>
                )}

                {seekerResult.summary && (
                  <div style={{ background: '#f0edff', borderRadius: '12px', padding: '1rem 1.25rem', fontSize: '14px', color: '#3b1f8c', lineHeight: 1.6, marginBottom: '2rem' }}>
                    {seekerResult.summary}
                  </div>
                )}
              </>
            )}

            <Footer />
          </div>
        </div>
      );
    }

    return (
      <div className={styles.wrap}>
        <div className={styles.topbar}>
          <span className={styles.brand}>Smart<span>Hire</span></span>
          <ModeToggle />
          <div style={{ marginLeft: 'auto' }}><AuthButton /></div>
        </div>
        <div className={styles.uploadPage}>
          <div className={styles.hero}>
            <h1 className={styles.title}>Job Seeker Mode</h1>
            <p className={styles.sub}>Check your resume against any job description</p>
          </div>
          <div className={styles.card}>
            <label className={styles.label}>
              Job Description <span style={{ fontWeight: 400, opacity: 0.5 }}>(optional)</span>
            </label>
            <textarea
              className={styles.textarea}
              placeholder="Paste job description for match score, or leave blank for general resume quality score..."
              value={seekerJD}
              onChange={e => setSeekerJD(e.target.value)}
              rows={6}
            />
            <label className={styles.label}>Your Resume</label>
            <div className={styles.modeToggle} style={{ marginBottom: '12px' }}>
              <button
                className={seekerInputMode === 'file' ? styles.modeBtnActive : styles.modeBtn}
                onClick={() => setSeekerInputMode('file')}
              >Upload File</button>
              <button
                className={seekerInputMode === 'text' ? styles.modeBtnActive : styles.modeBtn}
                onClick={() => setSeekerInputMode('text')}
              >Paste Text</button>
            </div>
            {seekerInputMode === 'file' ? (
              <>
                <div className={styles.uploadBox} onClick={() => document.getElementById('seekerFileInput')?.click()}>
                  {seekerResumeFile ? <span>{seekerResumeFile.name}</span> : <span>Click to upload — PDF, DOCX, DOC, TXT</span>}
                </div>
                <input id="seekerFileInput" type="file" accept=".pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={e => setSeekerResumeFile(e.target.files?.[0] || null)} />
              </>
            ) : (
              <textarea
                className={styles.textarea}
                placeholder="Paste your resume text here..."
                value={seekerResumeText}
                onChange={e => setSeekerResumeText(e.target.value)}
                rows={8}
              />
            )}
            {seekerError && <p className={styles.error}>{seekerError}</p>}
            <button className={styles.btn} onClick={handleCheckATS} disabled={seekerLoading}>
              {seekerLoading ? 'Checking...' : 'Check ATS Score'}
            </button>
          </div>
          <Footer centered />
        </div>
      </div>
    );
  }

  if (analyzed) {
    const shortlisted = candidates.filter(c => c.shortlisted);
    const notShortlisted = candidates.filter(c => !c.shortlisted);

    return (
      <div className={styles.wrap}>
        <div className={styles.topbar}>
          <span className={styles.brand}>Smart<span>Hire</span></span>
          <ModeToggle />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AuthButton />
            <div className={styles.topbarRight}>
              <button className={styles.tbtn} onClick={handleExportCSV}>Export CSV</button>
              <button
                className={`${styles.tbtn} ${styles.tbtnAccent}`}
                onClick={handleExportPDF}
                disabled={shortlisted.length === 0 || exportLoading}
              >
                {exportLoading ? 'Generating...' : 'Export PDF'}
              </button>
              <button
                className={styles.tbtn}
                onClick={() => { setAnalyzed(false); setCandidates([]); setGarbage([]); }}
              >
                New Analysis
              </button>
            </div>
          </div>
        </div>

        <div className={styles.content}>
          {shortlisted.length > 0 && (
            <div>
              <div className={styles.sectionHead}>
                <span className={styles.sectionTitle}>Shortlisted</span>
                <span className={styles.sectionCount}>{shortlisted.length + ' candidate' + (shortlisted.length > 1 ? 's' : '')}</span>
              </div>
              <div className={styles.cards}>
                {shortlisted.map((c, i) => (
                  <CandidateCard key={i} c={c} globalIndex={candidates.indexOf(c)} rank={i + 1} />
                ))}
              </div>
            </div>
          )}

          <div className={styles.divider} />

          {notShortlisted.length > 0 && (
            <div>
              <div className={styles.sectionHead}>
                <span className={styles.sectionTitle}>Not Shortlisted</span>
                <span className={styles.sectionCount}>{notShortlisted.length + ' candidate' + (notShortlisted.length > 1 ? 's' : '')}</span>
              </div>
              <div className={styles.collapseRow} onClick={() => setShowNotShortlisted(!showNotShortlisted)}>
                <span className={styles.collapseHint}>Score below 70% — {notShortlisted.length + ' candidate' + (notShortlisted.length > 1 ? 's' : '')}</span>
                <span className={styles.collapseAction}>{showNotShortlisted ? 'Hide' : 'Show'}</span>
              </div>
              {showNotShortlisted && (
                <div className={styles.cards} style={{ marginTop: '8px' }}>
                  {notShortlisted.map((c, i) => (
                    <CandidateCard key={i} c={c} globalIndex={candidates.indexOf(c)} rank={shortlisted.length + i + 1} />
                  ))}
                </div>
              )}
            </div>
          )}

          {garbage.length > 0 && (
            <div>
              <div className={styles.sectionHead}>
                <span className={styles.sectionTitle}>Rejected Files</span>
                <span className={styles.sectionCount}>{garbage.length + ' file' + (garbage.length > 1 ? 's' : '')}</span>
              </div>
              <div className={styles.garbageBlock}>
                {garbage.map((g, i) => (
                  <div key={i} className={styles.garbageRow}>
                    <span>{g.filename}</span>
                    <span className={styles.badgeRejected}>Not a resume</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Footer />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <span className={styles.brand}>Smart<span>Hire</span></span>
        <ModeToggle />
        <div style={{ marginLeft: 'auto' }}><AuthButton /></div>
      </div>
      <div className={styles.uploadPage}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Smart<span>Hire</span></h1>
          <p className={styles.sub}>AI-powered bulk resume screener</p>
        </div>
        <div className={styles.card}>
          <label className={styles.label}>Job Description</label>
          <textarea
            className={styles.textarea}
            placeholder="Paste job description here..."
            value={jobDescription}
            onChange={e => setJobDescription(e.target.value)}
            rows={6}
          />
          <label className={styles.label}>Upload Resumes</label>
          <div className={styles.uploadBox} onClick={() => document.getElementById('fileInput')?.click()}>
            {resumes?.length
              ? <span>{resumes.length + ' file' + (resumes.length > 1 ? 's' : '') + ' selected'}</span>
              : <span>Click to upload — PDF, DOCX, DOC, TXT (up to 100)</span>}
          </div>
          <input
            id="fileInput"
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            multiple
            style={{ display: 'none' }}
            onChange={e => setResumes(e.target.files)}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.btn} onClick={handleAnalyze} disabled={loading}>
            {loading ? 'Analyzing ' + resumes?.length + ' resumes...' : 'Analyze Resumes'}
          </button>
        </div>
        <Footer centered />
      </div>
    </div>
  );
}