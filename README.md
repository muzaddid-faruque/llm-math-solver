# llm-math-solver

[![Python CI](https://github.com/muzaddid-faruque/llm-math-solver/actions/workflows/python-ci.yml/badge.svg)](https://github.com/muzaddid-faruque/llm-math-solver/actions/workflows/python-ci.yml)
[![License](https://img.shields.io/github/license/muzaddid-faruque/llm-math-solver.svg)](LICENSE)

Minimal project to extract and solve math problems from images using LLM APIs.

## Structure

- `backend/` — FastAPI backend that accepts an image and forwards it to Perplexity or Gemini.
- `frontend/` — (empty now)

## Setup

1. Copy the example env file and fill your keys:

```powershell
copy backend\.env.example backend\.env
# then edit backend\.env to add real API keys
```

2. Install dependencies (from `backend/`):

```powershell
pip install -r backend\requirements.txt
```

3. Run the backend (from `backend/`):

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints

- `GET /` — health message
- `POST /solve-perplexity` — multipart upload an image (field name `file`) to call Perplexity API
- `POST /solve-gemini` — multipart upload an image (field name `file`) to call Gemini via the Google GenAI SDK

Both endpoints expect the model to return a single JSON object with keys: `latex`, `answer`, `steps`, `notes`.

## License

This project is released under the [MIT License](LICENSE).

## Continuous Integration (CI)

The repository includes a GitHub Actions workflow at `.github/workflows/python-ci.yml`.
- The workflow runs on pushes and pull requests to `main`.
- It sets up Python (3.10 and 3.11), installs `backend/requirements.txt` (if present), installs `flake8` and `pytest`, then runs linting and tests.

To run the same checks locally:

```powershell
# Install dependencies
pip install -r backend\requirements.txt
pip install flake8 pytest

# Lint
flake8 backend

# Run tests (if any)
pytest backend
```

