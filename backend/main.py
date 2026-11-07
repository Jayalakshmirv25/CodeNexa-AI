from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, String, Text, create_engine, desc, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

MAX_CODE_BYTES = int(os.getenv("MAX_CODE_BYTES", "200000"))
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./codeguard.db")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")
CODEBERT_MODEL = os.getenv("CODEBERT_MODEL", "")
DEFECT_CLASSIFIER_PATH = os.getenv("DEFECT_CLASSIFIER_PATH", "")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class AnalysisReport(Base):
    __tablename__ = "analysis_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    language: Mapped[str] = mapped_column(String(40), nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AnalyzeRequest(BaseModel):
    code: str = Field(max_length=MAX_CODE_BYTES)
    filename: str = Field(default="snippet.py", max_length=255)


def _finding(
    *, tool: str, code: str, message: str, line: int | None, severity: str, category: str
) -> dict[str, Any]:
    return {
        "id": f"{tool}:{code}:{line or 0}",
        "tool": tool,
        "code": code,
        "message": message,
        "line": line,
        "severity": severity,
        "category": category,
    }


def parse_ruff(output: str) -> list[dict[str, Any]]:
    try:
        messages = json.loads(output or "[]")
    except json.JSONDecodeError as exc:
        raise ValueError("Ruff returned invalid JSON") from exc
    findings = []
    for item in messages if isinstance(messages, list) else []:
        code = str(item.get("code") or "RUFF")
        severity = "error" if code.startswith(("E", "F")) else "warning"
        findings.append(
            _finding(
                tool="Ruff",
                code=code,
                message=str(item.get("message", "Lint issue"))[:1000],
                line=item.get("location", {}).get("row"),
                severity=severity,
                category="quality",
            )
        )
    return findings


def parse_pylint(output: str) -> list[dict[str, Any]]:
    try:
        messages = json.loads(output or "[]")
    except json.JSONDecodeError as exc:
        raise ValueError("Pylint returned invalid JSON") from exc
    findings = []
    for item in messages if isinstance(messages, list) else []:
        kind = str(item.get("type", "warning")).lower()
        severity = "error" if kind in {"error", "fatal"} else "warning"
        findings.append(
            _finding(
                tool="Pylint",
                code=str(item.get("message-id") or item.get("symbol") or "PYLINT"),
                message=str(item.get("message", "Lint issue"))[:1000],
                line=item.get("line"),
                severity=severity,
                category="quality",
            )
        )
    return findings


def parse_bandit(output: str) -> list[dict[str, Any]]:
    try:
        report = json.loads(output or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Bandit returned invalid JSON") from exc
    if not isinstance(report, dict):
        raise TypeError("Bandit returned an invalid report")
    findings = []
    for item in report.get("results", []):
        bandit_severity = str(item.get("issue_severity", "LOW")).upper()
        severity = "critical" if bandit_severity == "HIGH" else (
            "warning" if bandit_severity == "MEDIUM" else "info"
        )
        findings.append(
            _finding(
                tool="Bandit",
                code=str(item.get("test_id") or "BANDIT"),
                message=str(item.get("issue_text", "Security issue"))[:1000],
                line=item.get("line_number"),
                severity=severity,
                category="security",
            )
        )
    return findings


def _run_tool(
    name: str, command: list[str], cwd: str, parser: Any
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return [], {"status": "error", "error": "Analysis timed out after 30 seconds"}
    except OSError as exc:
        return [], {"status": "error", "error": f"Could not start {name}: {exc}"}
    output = result.stdout
    if not result.stdout.strip():
        if result.returncode == 0:
            return [], {"status": "error", "error": f"{name} returned no report"}
        return [], {
            "status": "error",
            "error": (result.stderr or output or f"{name} exited with code {result.returncode}")[:1000],
        }
    try:
        return parser(output), {"status": "complete"}
    except (TypeError, ValueError) as exc:
        return [], {"status": "error", "error": f"{exc}: {(result.stderr or output)[:500]}"}


@lru_cache(maxsize=1)
def _load_defect_model() -> tuple[Any, Any, Any]:
    import joblib
    from transformers import AutoModel, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(CODEBERT_MODEL, local_files_only=True)
    encoder = AutoModel.from_pretrained(CODEBERT_MODEL, local_files_only=True)
    classifier = joblib.load(DEFECT_CLASSIFIER_PATH)
    return tokenizer, encoder, classifier


def _classify_defect(code: str) -> dict[str, Any]:
    if not CODEBERT_MODEL or not DEFECT_CLASSIFIER_PATH:
        return {
            "status": "not_configured",
            "message": "Configure a local CodeBERT checkpoint and a fitted scikit-learn classifier.",
            "label": None,
            "confidence": None,
        }
    try:
        import torch

        tokenizer, encoder, classifier = _load_defect_model()
        tokens = tokenizer(code, return_tensors="pt", truncation=True, max_length=512)
        encoder.eval()
        with torch.no_grad():
            hidden = encoder(**tokens).last_hidden_state
            mask = tokens["attention_mask"].unsqueeze(-1)
            vector = ((hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)).cpu().numpy()
        label = str(classifier.predict(vector)[0])
        probabilities = classifier.predict_proba(vector)[0] if hasattr(classifier, "predict_proba") else None
        confidence = float(max(probabilities)) if probabilities is not None else None
        return {
            "status": "complete",
            "label": label,
            "confidence": round(confidence, 4) if confidence is not None else None,
        }
    except (ImportError, OSError, ValueError, RuntimeError, AttributeError, EOFError, KeyError, TypeError) as exc:
        return {
            "status": "error",
            "message": f"CodeBERT classification failed: {str(exc)[:500]}",
            "label": None,
            "confidence": None,
        }


def _ollama_status() -> dict[str, str]:
    if not OLLAMA_MODEL:
        return {"status": "not_configured", "message": "Set OLLAMA_MODEL to enable AI insights."}
    return {"status": "configured", "model": OLLAMA_MODEL}


async def _generate_ai(code: str, findings: list[dict[str, Any]]) -> dict[str, Any]:
    status = _ollama_status()
    if status["status"] != "configured":
        return {
            "status": status["status"],
            "message": status["message"],
            "explanation": None,
            "suggestion": None,
            "tests": [],
        }
    prompt = (
        "Review this Python code and the real static-analysis findings. Do not invent findings. "
        "Return only JSON with keys explanation (string), suggestion (string; corrected code "
        "or empty string), and tests (array of unittest test-case source strings). Be concise. "
        "If there are no findings, state that in explanation and provide only useful tests.\n"
        f"Findings: {json.dumps(findings, ensure_ascii=True)}\n"
        f"Code:\n```python\n{code}\n```"
    )
    try:
        timeout = httpx.Timeout(90, connect=3, read=90, write=10, pool=5)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "format": "json"},
            )
            response.raise_for_status()
        generated = response.json().get("response", "")
        payload = json.loads(generated)
        if not isinstance(payload, dict):
            raise TypeError("Ollama returned a non-object response")
        tests = payload.get("tests", [])
        if not isinstance(tests, list) or not all(isinstance(test, str) for test in tests):
            raise ValueError("Ollama returned an invalid tests field")
        return {
            "status": "complete",
            "model": OLLAMA_MODEL,
            "explanation": str(payload.get("explanation", ""))[:10000],
            "suggestion": str(payload.get("suggestion", ""))[:20000],
            "tests": [test[:10000] for test in tests[:10]],
        }
    except (httpx.HTTPError, json.JSONDecodeError, ValueError, TypeError, KeyError) as exc:
        return {
            "status": "error",
            "message": f"Ollama request failed: {str(exc)[:500]}",
            "explanation": None,
            "suggestion": None,
            "tests": [],
        }


async def analyze_code(code: str, filename: str) -> dict[str, Any]:
    if not code.strip():
        raise HTTPException(status_code=422, detail="Code cannot be empty.")
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise HTTPException(status_code=413, detail=f"Code exceeds the {MAX_CODE_BYTES}-byte limit.")
    if Path(filename).suffix.lower() != ".py":
        raise HTTPException(status_code=415, detail="Only Python (.py) files are supported.")

    started = time.monotonic()
    findings: list[dict[str, Any]] = []
    tools: dict[str, dict[str, str]] = {}
    with tempfile.TemporaryDirectory(prefix="codeguard-") as directory:
        source = Path(directory) / "submission.py"
        source.write_text(code, encoding="utf-8")
        tool_runs = [
            ("ruff", [sys.executable, "-m", "ruff", "check", "--output-format", "json", str(source)], parse_ruff),
            ("pylint", [sys.executable, "-m", "pylint", "--output-format=json", str(source)], parse_pylint),
            ("bandit", [sys.executable, "-m", "bandit", "-f", "json", str(source)], parse_bandit),
        ]
        results = await asyncio.gather(
            *(asyncio.to_thread(_run_tool, name, command, directory, parser) for name, command, parser in tool_runs)
        )
        for (name, _, _), (tool_findings, tool_status) in zip(tool_runs, results):
            tools[name] = tool_status
            findings.extend(tool_findings)

    unique_findings = {finding["id"]: finding for finding in findings}
    findings = sorted(
        unique_findings.values(),
        key=lambda item: (
            {"critical": 0, "error": 1, "warning": 2, "info": 3}.get(item["severity"], 4),
            item["line"] or 0,
            item["tool"],
        ),
    )
    error_count = sum(item["severity"] in {"critical", "error"} for item in findings)
    warning_count = sum(item["severity"] == "warning" for item in findings)
    security_count = sum(item["category"] == "security" for item in findings)
    quality_score = max(0, 100 - error_count * 12 - warning_count * 4 - security_count * 15)
    ai = await _generate_ai(code, findings)
    classification = _classify_defect(code)
    return {
        "id": str(uuid.uuid4()),
        "filename": Path(filename).name[:255],
        "language": "Python",
        "created_at": datetime.now(UTC).isoformat(),
        "duration_seconds": round(time.monotonic() - started, 2),
        "summary": {
            "bugs": error_count,
            "warnings": warning_count,
            "security_issues": security_count,
            "quality_score": quality_score,
            "security_check": (
                "issues_found"
                if security_count
                else "passed"
                if tools["bandit"]["status"] == "complete"
                else "unavailable"
            ),
            "issue_count": len(findings),
        },
        "findings": findings,
        "tools": tools,
        "ai": ai,
        "defect_classification": classification,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="CodeGuard AI API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        with engine.connect() as connection:
            connection.execute(select(1))
        database = "online"
    except SQLAlchemyError as exc:
        database = f"error: {str(exc)[:300]}"
    return {
        "status": "online" if database == "online" else "degraded",
        "database": database,
        "ollama": _ollama_status(),
        "codebert": {
            "status": "configured" if CODEBERT_MODEL and DEFECT_CLASSIFIER_PATH else "not_configured"
        },
        "analyzers": ["Ruff", "Pylint", "Bandit"],
    }


@app.post("/api/analyze")
async def create_analysis(request: AnalyzeRequest) -> dict[str, Any]:
    report = await analyze_code(request.code, request.filename)
    with SessionLocal() as session:
        session.add(
            AnalysisReport(
                id=report["id"],
                filename=report["filename"],
                language=report["language"],
                code=request.code,
                result=json.dumps(report),
                created_at=datetime.now(UTC),
            )
        )
        session.commit()
    return report


@app.post("/api/analyze/upload")
async def upload_analysis(file: Annotated[UploadFile, File()]) -> dict[str, Any]:
    if Path(file.filename or "").suffix.lower() != ".py":
        raise HTTPException(status_code=415, detail="Only Python (.py) files are supported.")
    content = await file.read(MAX_CODE_BYTES + 1)
    if len(content) > MAX_CODE_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_CODE_BYTES}-byte limit.")
    try:
        code = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=415, detail="Uploaded file must be UTF-8 encoded.") from exc
    return await create_analysis(AnalyzeRequest(code=code, filename=Path(file.filename).name))


@app.get("/api/reports")
def list_reports(limit: int = 50) -> list[dict[str, Any]]:
    with SessionLocal() as session:
        reports = session.scalars(
            select(AnalysisReport).order_by(desc(AnalysisReport.created_at)).limit(max(1, min(limit, 100)))
        ).all()
    return [json.loads(report.result) for report in reports]


@app.get("/api/reports/{report_id}")
def get_report(report_id: str) -> dict[str, Any]:
    with SessionLocal() as session:
        report = session.get(AnalysisReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    return json.loads(report.result)


@app.get("/api/reports/{report_id}/source")
def get_report_source(report_id: str) -> dict[str, str]:
    with SessionLocal() as session:
        report = session.get(AnalysisReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    return {"filename": report.filename, "code": report.code}
