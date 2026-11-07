# CodeNexa AI

CodeNexa AI is a local-first Python code review dashboard. It runs Ruff, Pylint and Bandit against submitted Python source, stores the resulting reports and source in PostgreSQL, and can optionally use a local Ollama model to explain findings and suggest fixes and tests. The React interface follows the supplied dark SaaS dashboard reference.

Static analysis does not execute submitted code. AI-generated output is optional and should be reviewed before use. The quality percentage is a deterministic score, not a model score: `max(0, 100 - 12 × errors/critical - 4 × warnings - 15 × security findings)`, based on actual analyzer findings.

## Run with Docker Compose

Requirements: Docker Desktop with Compose.

1. Copy `.env.example` to `.env` if you want to configure a local Ollama model (optional).
2. Start the app:

   ```powershell
   docker compose up --build
   ```

3. Open the dashboard at <http://localhost:8080>. The API docs are at <http://localhost:8000/docs>.
4. Stop with `docker compose down`. Reports persist in the `postgres_data` volume.

The backend runs all three analyzers in its container. Ollama should be running on the host. Pull a model such as `qwen2.5-coder:3b`, then set `OLLAMA_MODEL=qwen2.5-coder:3b` in `.env` and restart the backend. Compose connects to Ollama at `host.docker.internal:11434` by default.

## Run locally (without Docker)

Requirements: Python 3.11+, Node.js 20+ and PostgreSQL 16+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
$env:DATABASE_URL = "postgresql+psycopg://codeguard:your-password@localhost:5432/codeguard"
$env:OLLAMA_MODEL = "qwen2.5-coder:3b" # optional
uvicorn backend.main:app --reload
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. For a local-only quick start without PostgreSQL, omit `DATABASE_URL`; the API uses `./codeguard.db` (SQLite).

## Use

- Paste Python into the editor or upload a UTF-8 `.py` file (200 KB limit), then select **Run Analysis**.
- Review real Ruff, Pylint and Bandit findings, the tool execution status, and the derived quality score.
- Open **History** to revisit saved reports and source code.
- Set `OLLAMA_MODEL` to enable local explanations, suggested changes and unit-test recommendations. When Ollama is unavailable or not configured, the dashboard reports that instead of presenting generated or placeholder content.
- Optional defect classification uses CodeBERT embeddings and a fitted scikit-learn classifier. To train one, install `backend\requirements-ai.txt`, download a CodeBERT checkpoint to a local directory, and prepare a JSONL file with labeled `code` and `label` fields (use your own verified examples). Then run:

  ```powershell
  python backend\train_classifier.py --model C:\models\codebert-base --dataset C:\data\labeled-code.jsonl --output models\defect-classifier.joblib
  ```

  Set `CODEBERT_MODEL` to that checkpoint directory and `DEFECT_CLASSIFIER_PATH` to the saved classifier. Models and training data are intentionally not bundled. For Compose, put both artifacts under `AI_MODELS_DIR` (default `./models`), set `INSTALL_AI=1`, and rebuild; Compose mounts the directory at `/models`. Set `CODEBERT_MODEL=/models/codebert-base` and `DEFECT_CLASSIFIER_PATH=/models/defect-classifier.joblib` as needed. Only load classifier files you trust.
- API endpoints: `POST /api/analyze`, `POST /api/analyze/upload`, `GET /api/reports`, `GET /api/reports/{id}`, `GET /api/reports/{id}/source`, and `GET /api/health`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./codeguard.db` | SQLAlchemy database URL; Compose configures PostgreSQL |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama endpoint |
| `OLLAMA_MODEL` | unset | Local model name; AI features stay off when unset |
| `MAX_CODE_BYTES` | `200000` | Maximum submission size |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed browser origins |

## Scope and limitations

The editor and upload flow currently accept Python files. Static analyzers are the source of reported findings; no sample findings are inserted into reports. CodeBERT/scikit-learn classification requires a defect-classification model and a fitted classifier, neither of which is bundled or silently fabricated. Ollama explanation, suggestions and tests require an available local model.
