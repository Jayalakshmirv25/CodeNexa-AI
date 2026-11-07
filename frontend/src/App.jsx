import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, BookOpen, Check,
  CheckCircle2, ChevronRight, Clock3, Code2, Copy, FileCode2, FileText, Folder,
  History, Info, Lightbulb, LoaderCircle, LockKeyhole, Menu, Moon, Play, Plus,
  Search, Settings, Shield, ShieldCheck, Sparkles, Sun, Upload, X, Zap,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";
const starter = `def divide(a, b):
    return a / b


print(divide(10, 0))  # risky division`;
const navItems = [
  ["Dashboard", BarChart3], ["New Analysis", Plus], ["History", History],
  ["Projects", Folder], ["Settings", Settings], ["About", Info],
];

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch { /* Response may not include JSON. */ }
    throw new Error(message);
  }
  return response.json();
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function App() {
  const [code, setCode] = useState(starter);
  const [filename, setFilename] = useState("snippet.py");
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [section, setSection] = useState("Dashboard");
  const [tab, setTab] = useState("Issues");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);
  const [copied, setCopied] = useState(false);
  const [dark, setDark] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const fileRef = useRef(null);

  const loadHistory = async () => {
    try {
      const rows = await request("/api/reports");
      setHistory(rows);
    } catch (issue) { setError(issue.message); }
  };
  useEffect(() => {
    request("/api/health").then(setHealth).catch((issue) => setError(issue.message));
    loadHistory();
  }, []);

  const analyze = async () => {
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await request("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, filename }),
      });
      setReport(result);
      setTab("Issues");
      setSection("Dashboard");
      await loadHistory();
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  };

  const openReport = async (id) => {
    try {
      const [result, source] = await Promise.all([
        request(`/api/reports/${id}`), request(`/api/reports/${id}/source`),
      ]);
      setReport(result);
      setCode(source.code);
      setFilename(source.filename);
      setTab("Issues");
      setSection("Dashboard");
    } catch (issue) { setError(issue.message); }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".py")) {
      setError("Only Python (.py) files are supported.");
      event.target.value = "";
      return;
    }
    if (file.size > 200000) {
      setError("File exceeds the 200 KB upload limit.");
      event.target.value = "";
      return;
    }
    try {
      setCode(await file.text());
      setFilename(file.name);
      setReport(null);
      setError("");
    } catch { setError("Could not read the selected file."); }
    event.target.value = "";
  };

  const issues = report?.findings || [];

  const copySuggestion = async () => {
    if (!report?.ai?.suggestion) return;
    try {
      await navigator.clipboard.writeText(report.ai.suggestion);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard access was denied. Select and copy the suggestion manually.");
    }
  };

  const pasteCode = async () => {
    try {
      const pasted = await navigator.clipboard.readText();
      if (!pasted) {
        setError("Clipboard is empty.");
        return;
      }
      setCode(pasted);
      setFilename("pasted-code.py");
      setReport(null);
      setError("");
    } catch {
      setError("Clipboard access was denied. Paste directly into the editor with Ctrl+V.");
      document.querySelector(".cm-content")?.focus();
    }
  };

  const selectNav = (label) => {
    setSection(label);
    setMobileNav(false);
    setError("");
  };

  return (
    <div className={`app-shell ${dark ? "theme-dark" : "theme-light"}`}>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Shield size={29} /><Code2 size={16} /></div>
          <strong>CodeNexa AI</strong>
          <span>Review · Detect · Improve</span>
        </div>
        <button className="new-analysis" onClick={() => { selectNav("Dashboard"); setReport(null); }}>
          <Play size={15} fill="currentColor" /> New Analysis
        </button>
        <nav>
          {navItems.map(([label, Icon]) => (
            <button key={label} className={`nav-item ${section === label ? "active" : ""}`} onClick={() => selectNav(label)}>
              <Icon size={17} />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`service-status ${health?.status === "online" ? "online" : "offline"}`}>
            <span className="status-dot" />
            <div><b>{health?.status === "online" ? "System Online" : health ? "System Degraded" : "Connecting…"}</b><small>{health ? "API · Database" : "Checking services"}</small></div>
          </div>
          <div className="open-source"><Zap size={17} /><div><b>Powered by Open Source</b><small>Ruff · Pylint · Bandit · Ollama</small></div></div>
          <small className="version">v1.0.0</small>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><b>{section}</b></div>
          <div className="top-actions">
            <span className="api-pill"><i className={health?.status === "online" ? "dot-good" : "dot-warn"} />{health?.status === "online" ? "API connected" : "API unavailable"}</span>
            <button className="icon-button" aria-label="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <div className="avatar">JR</div>
          </div>
        </header>

        {error && <div className="error-banner"><AlertTriangle size={17} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}

        {section === "History" ? (
          <HistoryPage reports={history} openReport={openReport} onNew={() => { selectNav("Dashboard"); setReport(null); }} />
        ) : section === "Projects" ? (
          <ProjectsPage history={history} onOpen={openReport} />
        ) : section === "Settings" ? (
          <SettingsPage health={health} />
        ) : section === "About" ? (
          <AboutPage />
        ) : section === "Report" ? (
          <DetailedReport report={report} code={code} onBack={() => setSection("Dashboard")} onCopy={copySuggestion} copied={copied} />
        ) : (
          <>
            <section className="welcome">
              <div><div className="welcome-title"><span>👋</span><h1>Welcome back, Jayalakshmi!</h1></div><p>Analyze your code with the power of static analysis and local AI.</p></div>
              <div className="welcome-art" aria-hidden="true"><div className="art-glow" /><Code2 size={62} /><span>CODE REVIEW</span></div>
            </section>

            <section className="feature-strip" aria-label="Analysis features">
              <Feature icon={<CheckCircle2 />} title="Static Analysis" description="Pylint, Bandit, Ruff" tone="green" />
              <Feature icon={<Sparkles />} title="AI Code Review" description="CodeBERT + Ollama" tone="purple" />
              <Feature icon={<Zap />} title="Smart Suggestions" description="Explain & improve" tone="blue" />
              <Feature icon={<ShieldCheck />} title="Security Scan" description="Detect vulnerabilities" tone="teal" />
              <Feature icon={<BarChart3 />} title="Track Progress" description="View analysis history" tone="indigo" />
            </section>

            <section className="workspace-grid">
              <div className="editor-card panel">
                <div className="panel-heading editor-heading">
                  <div className="heading-label"><FileCode2 size={17} /><b>Your Code</b><span className="filename">{filename}</span></div>
                  <div className="editor-actions">
                    <input ref={fileRef} type="file" accept=".py,text/x-python" hidden onChange={onFile} />
                    <button className="small-button" onClick={() => fileRef.current?.click()}><Upload size={14} />Upload File</button>
                    <span className="or-label">or</span><button className="small-button subtle" onClick={pasteCode}>Paste Code</button>
                  </div>
                </div>
                <div className="code-editor">
                  <CodeMirror value={code} height="180px" extensions={[python()]} onChange={(value) => { setCode(value); setReport(null); }} />
                </div>
                <div className="editor-footer"><span>Python 3 · UTF-8</span><span>{code.length.toLocaleString()} characters</span></div>
              </div>

              <div className="results-column">
                <div className="summary-card panel">
                  <button className="run-button" disabled={busy || !health || health.status !== "online"} onClick={analyze}>
                    {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}{busy ? "Analyzing…" : "Run Analysis"}
                  </button>
                  {report ? (
                    <>
                      <div className="analysis-state"><CheckCircle2 size={28} /><div><b>Analysis complete</b><small>{report.filename} · {report.duration_seconds}s · {formatTime(report.created_at)}</small></div><span className="elapsed"><Clock3 size={12} />{report.duration_seconds}s</span></div>
                      <div className="metric-grid">
                        <Metric icon={<AlertTriangle />} value={report.summary.bugs} label="Bugs found" tone="red" />
                        <Metric icon={<Info />} value={report.summary.warnings} label="Warnings" tone="amber" />
                        <Metric icon={<ShieldCheck />} value={`${report.summary.quality_score}%`} label="Code quality" tone="green" />
                        <Metric icon={<Check />} value={report.summary.security_check === "unavailable" ? "Unavailable" : report.summary.security_check === "passed" ? "Passed" : `${report.summary.security_issues} found`} label="Security check" tone={report.summary.security_check === "unavailable" ? "amber" : report.summary.security_issues ? "red" : "blue"} />
                      </div>
                      {Object.entries(report.tools).some(([, status]) => status.status === "error") && <div className="tool-warning">Some analyzers could not complete. See tool status below.</div>}
                    </>
                  ) : (
                    <div className="empty-summary"><div className="empty-icon"><FileText size={21} /></div><div><b>Ready to analyze</b><small>Run static analysis to see real findings from Ruff, Pylint and Bandit.</small></div></div>
                  )}
                </div>

                <div className="findings-card panel">
                  <div className="tabs" role="tablist">
                    {["Issues", "AI Insights", "Suggestions", "Unit Tests"].map((item) => (
                      <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "selected" : ""} onClick={() => setTab(item)}>
                        {item}{item === "Issues" && report && <span className="count-badge">{issues.length}</span>}
                      </button>
                    ))}
                  </div>
                  <div className="tab-content">
                    {tab === "Issues" && <Issues findings={issues} report={report} />}
                    {tab === "AI Insights" && <AIInsights report={report} />}
                    {tab === "Suggestions" && <Suggestion report={report} onCopy={copySuggestion} copied={copied} />}
                    {tab === "Unit Tests" && <Tests report={report} />}
                  </div>
                </div>
              </div>
            </section>

            <section className="lower-grid">
              <div className="explanation-card panel">
                <div className="section-title"><Lightbulb size={17} /><b>AI Explanation</b><span className={`powered-pill ${report?.ai?.status === "complete" ? "ready" : ""}`}><Sparkles size={11} />{report?.ai?.status === "complete" ? `Powered by ${report.ai.model}` : "Ollama optional"}</span></div>
                {report?.ai?.explanation ? <p>{report.ai.explanation}</p> : <p className="muted">{report ? aiMessage(report.ai) : "Run an analysis to receive a plain-language explanation from your configured local Ollama model."}</p>}
              </div>
              <div className="suggestion-card panel">
                <div className="section-title"><Zap size={17} /><b>Suggested Fix</b>{report?.ai?.suggestion && <button className="copy-button" onClick={copySuggestion}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button>}</div>
                {report?.ai?.suggestion ? <pre className="suggestion-code"><code>{report.ai.suggestion}</code></pre> : <p className="muted">{report ? aiMessage(report.ai) : "AI-generated code suggestions appear here when Ollama is configured."}</p>}
              </div>
            </section>

            <section className="report-cta">
              <div className="rocket">🚀</div><div><b>{report ? "Review the full analysis report" : "Ready to improve your code?"}</b><small>{report ? `${report.summary.issue_count} findings · ${report.summary.security_issues} security issues` : "Get detailed insights, best practices and actionable findings."}</small></div>
              <button onClick={() => report ? setSection("Report") : analyze()} disabled={busy || (!report && (!health || health.status !== "online"))}>{report ? "View Full Report" : "Run Analysis"}<ArrowRight size={15} /></button>
            </section>
          </>
        )}
      </main>
      {mobileNav && <button aria-label="Close navigation" className="nav-scrim" onClick={() => setMobileNav(false)} />}
    </div>
  );
}

function Feature({ icon, title, description, tone }) {
  return <div className="feature-card"><div className={`feature-icon ${tone}`}>{icon}</div><div><b>{title}</b><small>{description}</small></div></div>;
}
function Metric({ icon, value, label, tone }) {
  return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><b>{value}</b><small>{label}</small></div></div>;
}
function aiMessage(ai) {
  if (!ai) return "AI service status is not available yet.";
  if (ai.status === "not_configured") return ai.message;
  if (ai.status === "error") return ai.message;
  return "The local model did not return this content.";
}
function Issues({ findings, report }) {
  if (!report) return <EmptyState icon={<Search />} title="No analysis yet" text="Run an analysis to view findings from your local static analyzers." />;
  if (!findings.length && Object.values(report.tools).some((tool) => tool.status === "error")) return <EmptyState icon={<AlertTriangle />} title="Analysis incomplete" text="One or more analyzers failed. Check AI Insights for tool errors before treating this report as clean." />;
  if (!findings.length) return <EmptyState icon={<CheckCircle2 />} title="No findings reported" text="The configured analyzers did not report any issues for this file." />;
  return <div className="finding-list">{findings.map((item) => (
    <article key={item.id} className="finding-row">
      <span className={`severity ${item.severity}`}>{item.severity === "critical" ? "Security" : item.severity}</span>
      <div className="finding-copy"><b>{item.message}</b><small>{item.tool} · {item.code} · {item.category}</small></div>
      <span className="line-number">{item.line ? `Line ${item.line}` : "File"} <ChevronRight size={14} /></span>
    </article>
  ))}</div>;
}
function AIInsights({ report }) {
  if (!report) return <EmptyState icon={<Sparkles />} title="AI insights" text="Insights are generated using your configured local Ollama model after analysis." />;
  return <div className="insights-content">
    <div className="insight-status"><Sparkles size={16} /><b>{report.ai.status === "complete" ? `Generated by ${report.ai.model}` : "AI insights unavailable"}</b></div>
    <p>{report.ai.explanation || aiMessage(report.ai)}</p>
    <div className="classification-status"><ShieldCheck size={15} /><b>CodeBERT defect classification</b><span>{report.defect_classification?.status === "complete" ? `${report.defect_classification.label}${report.defect_classification.confidence == null ? "" : ` · ${(report.defect_classification.confidence * 100).toFixed(1)}% confidence`}` : report.defect_classification?.message || "Not configured"}</span></div>
    <div className="tool-status-list"><b>Static analyzer status</b>{Object.entries(report.tools).map(([name, state]) => <span key={name}><i className={state.status === "complete" ? "dot-good" : "dot-warn"} />{name}<small>{state.status === "complete" ? "Complete" : state.error}</small></span>)}</div>
  </div>;
}
function Suggestion({ report, onCopy, copied }) {
  if (!report) return <EmptyState icon={<Lightbulb />} title="Suggested improvements" text="Run an analysis and enable Ollama to get code suggestions grounded in real findings." />;
  if (!report.ai.suggestion) return <EmptyState icon={<Info />} title="No suggestion available" text={aiMessage(report.ai)} />;
  return <div className="tab-suggestion"><div className="tab-inline-head"><span>AI-generated suggestion · review before applying</span><button className="copy-button" onClick={onCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button></div><pre className="suggestion-code"><code>{report.ai.suggestion}</code></pre></div>;
}
function Tests({ report }) {
  if (!report) return <EmptyState icon={<BookOpen />} title="Unit test recommendations" text="Configure a local Ollama model to generate tests for your submitted code." />;
  if (!report.ai.tests?.length) return <EmptyState icon={<Info />} title="No test recommendations" text={aiMessage(report.ai)} />;
  return <div className="test-list">{report.ai.tests.map((test, index) => <pre className="suggestion-code" key={index}><code>{test}</code></pre>)}</div>;
}
function EmptyState({ icon, title, text }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><b>{title}</b><p>{text}</p></div>;
}
function DetailedReport({ report, code, onBack, onCopy, copied }) {
  if (!report) return <section className="page-section"><EmptyState icon={<FileText />} title="No report selected" text="Run an analysis to create a detailed report." /></section>;
  return <section className="page-section">
    <div className="page-heading"><div><span className="eyebrow">DETAILED ANALYSIS</span><h1>{report.filename}</h1><p>Python · Analyzed {formatTime(report.created_at)} · {report.duration_seconds}s</p></div><button className="small-button" onClick={onBack}><ArrowLeft size={14} />Back to dashboard</button></div>
    <div className="report-summary">
      <Metric icon={<AlertTriangle />} value={report.summary.bugs} label="Bugs found" tone="red" />
      <Metric icon={<Info />} value={report.summary.warnings} label="Warnings" tone="amber" />
      <Metric icon={<ShieldCheck />} value={`${report.summary.quality_score}%`} label="Code quality" tone="green" />
      <Metric icon={<Check />} value={report.summary.security_check === "unavailable" ? "Unavailable" : report.summary.security_check === "passed" ? "Passed" : `${report.summary.security_issues} found`} label="Security check" tone={report.summary.security_check === "unavailable" ? "amber" : report.summary.security_issues ? "red" : "blue"} />
    </div>
    <div className="detail-grid">
      <div className="panel detail-panel"><h2><Search size={16} />Findings ({report.summary.issue_count})</h2><Issues findings={report.findings} report={report} /></div>
      <div className="panel detail-panel"><h2><Sparkles size={16} />AI Insights</h2><AIInsights report={report} /></div>
      <div className="panel detail-panel"><h2><Lightbulb size={16} />Suggested Fix</h2><Suggestion report={report} onCopy={onCopy} copied={copied} /></div>
      <div className="panel detail-panel"><h2><BookOpen size={16} />Unit Test Recommendations</h2><Tests report={report} /></div>
    </div>
    <details className="source-details panel"><summary><Code2 size={15} />Analyzed source code</summary><pre className="suggestion-code"><code>{code}</code></pre></details>
  </section>;
}
function HistoryPage({ reports, openReport, onNew }) {
  return <section className="page-section">
    <div className="page-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Analysis History</h1><p>Previously saved reports from your code reviews.</p></div><button className="run-button" onClick={onNew}><Plus size={16} />New analysis</button></div>
    <div className="page-panel panel">
      {reports.length ? <div className="history-table"><div className="history-head"><span>File</span><span>Findings</span><span>Quality</span><span>Analyzed</span><span /></div>
        {reports.map((item) => <button className="history-row" key={item.id} onClick={() => openReport(item.id)}><span className="file-cell"><FileCode2 size={17} /><span><b>{item.filename}</b><small>Python · {item.id.slice(0, 8)}</small></span></span><span>{item.summary.issue_count} issues</span><span className="quality-cell">{item.summary.quality_score}%</span><span>{formatTime(item.created_at)}</span><ArrowRight size={15} /></button>)}
      </div> : <EmptyState icon={<History />} title="No reports yet" text="Your saved analyses will appear here after you run your first review." />}
    </div>
  </section>;
}
function ProjectsPage({ history, onOpen }) {
  const projectsByFile = new Map();
  for (const report of history) {
    const project = projectsByFile.get(report.filename) || { latest: report, analyses: 0 };
    project.analyses += 1;
    projectsByFile.set(report.filename, project);
  }
  const projects = [...projectsByFile.values()];
  return <section className="page-section"><div className="page-heading"><div><span className="eyebrow">ORGANIZE REVIEWS</span><h1>Projects</h1><p>Projects are grouped by analyzed file for this local workspace.</p></div></div>
    <div className="project-grid">{projects.length ? projects.map(({ latest, analyses }) => <button className="project-card panel" key={latest.filename} onClick={() => onOpen(latest.id)}><div className="project-icon"><Folder size={20} /></div><b>{latest.filename}</b><small>{analyses} saved {analyses === 1 ? "analysis" : "analyses"} · latest has {latest.summary.issue_count} findings</small><span>{formatTime(latest.created_at)}<ArrowRight size={14} /></span></button>) : <div className="page-panel panel"><EmptyState icon={<Folder />} title="No projects yet" text="Run an analysis to create your first project entry." /></div>}</div>
  </section>;
}
function SettingsPage({ health }) {
  return <section className="page-section"><div className="page-heading"><div><span className="eyebrow">PREFERENCES & SERVICES</span><h1>Settings</h1><p>Service configuration is provided through environment variables.</p></div></div>
    <div className="settings-grid"><div className="settings-card panel"><div className="settings-icon"><Zap /></div><h3>Analysis services</h3><p>Static analyzers run locally in the API container. Ollama is optional and never uses a paid cloud API.</p>
      <div className="setting-row"><span>FastAPI service</span><b className={health?.status === "online" ? "text-good" : "text-warn"}>{health?.status || "Checking"}</b></div>
      <div className="setting-row"><span>Database</span><b className={health?.database === "online" ? "text-good" : "text-warn"}>{health?.database || "Checking"}</b></div>
      <div className="setting-row"><span>Ollama</span><b className="text-muted">{health?.ollama?.status === "configured" ? health.ollama.model : "Not configured"}</b></div>
      <div className="setting-row"><span>Source code storage</span><b className="text-muted">Local PostgreSQL</b></div>
    </div><div className="settings-card panel"><div className="settings-icon blue"><LockKeyhole /></div><h3>Privacy & limits</h3><p>Submitted code is analyzed by local tools and saved with its report in your configured database.</p><div className="setting-row"><span>Maximum submission size</span><b>200 KB</b></div><div className="setting-row"><span>Supported language</span><b>Python</b></div><div className="setting-row"><span>External AI service</span><b>None</b></div></div></div>
  </section>;
}
function AboutPage() {
  return <section className="page-section"><div className="page-heading"><div><span className="eyebrow">CODENEXA AI</span><h1>About</h1><p>Open-source code analysis with a local-first approach.</p></div></div><div className="about-card panel"><div className="about-logo"><Shield size={27} /><Code2 size={16} /></div><h2>Review · Detect · Improve</h2><p>CodeNexa AI combines Ruff, Pylint and Bandit to report actual findings from your Python source. Optionally connect Ollama for locally generated explanations, suggestions and test ideas.</p><div className="about-tools"><span>FastAPI</span><span>React</span><span>PostgreSQL</span><span>Ollama (optional)</span></div></div></section>;
}

export default App;
