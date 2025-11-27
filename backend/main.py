# main.py
import os
import base64
import json
from typing import Optional, Any
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import requests

load_dotenv()
app = FastAPI()

# Development CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

LLM_PROMPT = """You are a careful math tutor. The user provided an image of a math problem.
Return ONLY a single JSON object with keys: "latex", "answer", "steps", "notes".
- "latex": the extracted problem as LaTeX
- "answer": the final exact answer(s)
- "steps": a numbered step-by-step solution (array or numbered text)
- "notes": ambiguous interpretations if any
Do not add any text outside the JSON.
"""

def try_extract_json_from_text(text: str) -> Optional[Any]:
    if not text or not isinstance(text, str):
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    candidate = text[start:end+1]
    try:
        return json.loads(candidate)
    except Exception:
        try:
            return json.loads(text)
        except Exception:
            return None

# ---------------------------
# Perplexity endpoint (unchanged)
# ---------------------------
@app.post("/solve-perplexity")
async def solve_perplexity(file: UploadFile = File(...)):
    if not PERPLEXITY_API_KEY:
        return {"error": "PERPLEXITY_API_KEY not set in .env"}
    try:
        img = await file.read()
        b64 = base64.b64encode(img).decode("utf-8")

        url = "https://api.perplexity.ai/chat/completions"
        headers = {
            "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
            "Content-Type": "application/json",
        }

        body = {
            "model": "pplx-sonar",
            "messages": [{"role": "user", "content": LLM_PROMPT}],
            "attachments": [
                {"type": "image", "mime_type": file.content_type, "data": b64, "filename": file.filename}
            ],
            "max_tokens": 1500
        }

        r = requests.post(url, headers=headers, json=body, timeout=90)
        r.raise_for_status()
        text = r.text
        parsed = None
        try:
            parsed = r.json()
        except Exception:
            parsed = try_extract_json_from_text(text)
        return {"raw": text, "parsed": parsed}
    except requests.HTTPError as he:
        return {"error": "Perplexity HTTP error", "detail": str(he), "response_text": getattr(he.response, "text", None)}
    except Exception as e:
        return {"error": "Perplexity call failed", "detail": str(e)}

# ---------------------------
# Gemini endpoint (image-capable model)
# ---------------------------
@app.post("/solve-gemini")
async def solve_gemini(file: UploadFile = File(...)):
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not set in .env"}

    try:
        img_bytes = await file.read()
    except Exception as e:
        return {"error": "Failed reading uploaded file", "detail": str(e)}

    # Import SDK and types
    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        return {"error": "google-genai SDK not installed or importable", "detail": str(e)}

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        return {"error": "Failed to initialize genai.Client", "detail": str(e)}

    # Create a Part from bytes (do not pass filename if not supported)
    try:
        image_part = types.Part.from_bytes(data=img_bytes, mime_type=file.content_type)
    except TypeError:
        try:
            image_part = types.Part.from_bytes(img_bytes, file.content_type)
        except Exception as e:
            return {"error": "Failed to create types.Part from bytes (fallback)", "detail": str(e)}
    except Exception as e:
        return {"error": "Failed to create types.Part from bytes", "detail": str(e)}

    # Use one of the image-capable models you listed
    model_name = "models/gemini-2.5-flash-image"  # <--- chosen model (change if you prefer another)

    contents = [image_part, LLM_PROMPT]

    # Try calling with config; fallback to minimal call
    try:
        resp = client.models.generate_content(
            model=model_name,
            contents=contents,
            config={
                "temperature": 0.2,
                "max_output_tokens": 1500,
            },
        )
    except TypeError:
        try:
            resp = client.models.generate_content(model=model_name, contents=contents)
        except Exception as e:
            return {"error": "Gemini generate_content call failed (fallback)", "detail": str(e)}
    except Exception as e:
        return {"error": "Gemini generate_content call failed", "detail": str(e)}

    # Extract text from response robustly
    raw_text = None
    parsed = None
    try:
        raw_text = getattr(resp, "text", None)
    except Exception:
        raw_text = None

    if not raw_text:
        try:
            out = getattr(resp, "output", None)
            if out and isinstance(out, (list, tuple)) and len(out) > 0:
                first = out[0]
                if isinstance(first, dict) and "content" in first:
                    content = first.get("content")
                    if isinstance(content, (list, tuple)) and len(content) > 0:
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "output_text":
                                raw_text = block.get("text")
                                break
                            if isinstance(block, dict) and "text" in block:
                                raw_text = block.get("text")
                                break
            if not raw_text:
                raw_text = str(resp)
        except Exception:
            raw_text = str(resp)

    parsed = try_extract_json_from_text(raw_text)
    return {"raw": raw_text, "parsed": parsed}

# ---------------------------
@app.get("/")
async def root():
    return {"message": "Backend running. POST to /solve-gemini or /solve-perplexity"}
