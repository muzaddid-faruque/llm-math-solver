# main.py
import os
import base64
import json
import logging
from typing import Optional, Any
from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
import requests
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()
app = FastAPI()

# Rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS Configuration - Allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins during development
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# File upload validation constants
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_MIMETYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/jpg"
}

# API Configuration
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "30"))

LLM_PROMPT = """You are a careful math tutor. The user provided an image of a math problem.
Return ONLY a single JSON object with keys: "latex", "answer", "steps", "notes".
- "latex": the extracted problem as LaTeX
- "answer": the final exact answer(s)
- "steps": a numbered step-by-step solution (array or numbered text)
- "notes": ambiguous interpretations if any
Do not add any text outside the JSON.
"""


def try_extract_json_from_text(text: str) -> Optional[Any]:
    """Try to find and parse the first JSON object inside text. Returns Python object or None."""
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


async def validate_and_read_image(file: UploadFile) -> bytes:
    """
    Validate uploaded image file and return its contents.

    Args:
        file: The uploaded file to validate

    Returns:
        bytes: The file contents if valid

    Raises:
        HTTPException: If file is invalid (wrong type, too large, or empty)
    """
    # Check mimetype
    if file.content_type not in ALLOWED_MIMETYPES:
        logger.warning(f"Invalid file type attempted: {file.content_type}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Only {', '.join(ALLOWED_MIMETYPES)} are allowed."
        )

    # Read with size limit (read one extra byte to detect oversized files)
    try:
        contents = await file.read(MAX_FILE_SIZE + 1)
    except Exception as e:
        logger.error(f"Error reading uploaded file: {e}")
        raise HTTPException(status_code=400, detail="Failed to read uploaded file")

    # Check file size
    if len(contents) > MAX_FILE_SIZE:
        logger.warning(f"Oversized file attempted: {len(contents)} bytes")
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB."
        )

    # Check if file is empty
    if len(contents) == 0:
        logger.warning("Empty file uploaded")
        raise HTTPException(status_code=400, detail="Empty file. Please upload a valid image.")

    logger.info(f"File validated: {file.content_type}, {len(contents)} bytes")
    return contents

# ---------------------------
# Perplexity endpoint (Sonar) - image inside messages[].content as data URI
# ---------------------------


@app.post("/solve-perplexity")
@limiter.limit("10/minute")
async def solve_perplexity(request: Request, file: UploadFile = File(...)):
    """
    Solve a math problem using Perplexity Sonar API.

    Args:
        request: FastAPI request object (required for rate limiting)
        file: Image file containing the math problem

    Returns:
        dict: Contains 'raw' response and 'parsed' JSON result
    """
    if not PERPLEXITY_API_KEY:
        logger.error("PERPLEXITY_API_KEY not configured")
        raise HTTPException(status_code=500, detail="API key not configured")

    try:
        # Validate and read image
        img = await validate_and_read_image(file)
        b64 = base64.b64encode(img).decode("utf-8")
        data_uri = f"data:{file.content_type};base64,{b64}"

        url = "https://api.perplexity.ai/chat/completions"
        headers = {
            "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
            "Content-Type": "application/json",
        }

        body = {
            "model": "sonar-pro",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": LLM_PROMPT},
                        {"type": "image_url", "image_url": {"url": data_uri}}
                    ]
                }
            ],
            "max_tokens": 1500
        }

        logger.info("Sending request to Perplexity API")
        r = requests.post(url, headers=headers, json=body, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        text = r.text
        parsed = None
        try:
            parsed = r.json()
        except Exception:
            parsed = try_extract_json_from_text(text)

        logger.info("Successfully received response from Perplexity")
        return {"raw": text, "parsed": parsed}

    except HTTPException:
        raise
    except requests.Timeout:
        logger.error("Perplexity API request timeout")
        raise HTTPException(status_code=504, detail="Request timeout. Please try again.")
    except requests.HTTPError as he:
        logger.error(f"Perplexity HTTP error: {he.response.status_code}")
        raise HTTPException(
            status_code=502,
            detail="External API error. Please try again later."
        )
    except Exception as e:
        logger.error(f"Unexpected error in solve_perplexity: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occurred")

# ---------------------------
# Gemini endpoint (using google-genai types.Part.from_bytes)
# ---------------------------


@app.post("/solve-gemini")
@limiter.limit("10/minute")
async def solve_gemini(request: Request, file: UploadFile = File(...)):
    """
    Solve a math problem using Google Gemini API.

    Args:
        request: FastAPI request object (required for rate limiting)
        file: Image file containing the math problem

    Returns:
        dict: Contains 'raw' response and 'parsed' JSON result
    """
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY not configured")
        raise HTTPException(status_code=500, detail="API key not configured")

    try:
        # Validate and read image
        img_bytes = await validate_and_read_image(file)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed reading uploaded file: {e}")
        raise HTTPException(status_code=400, detail="Failed to read uploaded file")

    # Import SDK and Part helper
    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        logger.error(f"google-genai SDK not available: {e}")
        raise HTTPException(status_code=500, detail="Server configuration error")

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        logger.error(f"Failed to initialize genai.Client: {e}")
        raise HTTPException(status_code=500, detail="API initialization error")

    # Create Part from bytes
    try:
        image_part = types.Part.from_bytes(data=img_bytes, mime_type=file.content_type)
    except TypeError:
        try:
            image_part = types.Part.from_bytes(img_bytes, file.content_type)
        except Exception as e:
            logger.error(f"Failed to create types.Part: {e}")
            raise HTTPException(status_code=500, detail="Image processing error")
    except Exception as e:
        logger.error(f"Failed to create types.Part: {e}")
        raise HTTPException(status_code=500, detail="Image processing error")

    model_name = "models/gemini-2.5-flash-image"
    contents = [image_part, LLM_PROMPT]

    # Try calling with config, fallback to minimal call shape
    try:
        logger.info("Sending request to Gemini API")
        resp = client.models.generate_content(
            model=model_name,
            contents=contents,
            config={"temperature": 0.2, "max_output_tokens": 1500},
        )
    except TypeError:
        try:
            resp = client.models.generate_content(model=model_name, contents=contents)
        except Exception as e:
            logger.error(f"Gemini API call failed: {e}", exc_info=True)
            raise HTTPException(status_code=502, detail="External API error")
    except Exception as e:
        logger.error(f"Gemini API call failed: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail="External API error")

    # Extract textual output robustly
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
    logger.info("Successfully received response from Gemini")
    return {"raw": raw_text, "parsed": parsed}

# ---------------------------
# New: ChatGPT / OpenAI endpoint
# ---------------------------


@app.post("/solve-chatgpt")
@limiter.limit("10/minute")
async def solve_chatgpt(request: Request, file: UploadFile = File(...)):
    """
    Solve a math problem using OpenAI ChatGPT API.

    Args:
        request: FastAPI request object (required for rate limiting)
        file: Image file containing the math problem

    Returns:
        dict: Contains 'raw' response and 'parsed' JSON result
    """
    if not OPENAI_API_KEY:
        logger.error("OPENAI_API_KEY not configured")
        raise HTTPException(status_code=500, detail="API key not configured")

    try:
        # Validate and read image
        img_bytes = await validate_and_read_image(file)
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        data_uri = f"data:{file.content_type};base64,{b64}"
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed reading uploaded file: {e}")
        raise HTTPException(status_code=400, detail="Failed to read uploaded file")

    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    messages = [
        {"role": "system", "content": LLM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Image data (base64 data URI):\n{data_uri}\n\n"
                "Please extract the math problem from the image and return ONLY "
                "the single JSON object as specified by the system prompt."
            )
        }
    ]

    body = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "max_tokens": 1500,
        "temperature": 0.0,
    }

    try:
        logger.info("Sending request to OpenAI API")
        r = requests.post(url, headers=headers, json=body, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        j = r.json()

        assistant_text = None
        try:
            assistant_text = j["choices"][0]["message"]["content"]
        except Exception:
            assistant_text = None

        parsed = None
        if assistant_text:
            parsed = try_extract_json_from_text(assistant_text)
        if not parsed:
            parsed = try_extract_json_from_text(json.dumps(j))

        logger.info("Successfully received response from OpenAI")
        return {"raw": json.dumps(j), "parsed": parsed}

    except requests.Timeout:
        logger.error("OpenAI API request timeout")
        raise HTTPException(status_code=504, detail="Request timeout. Please try again.")
    except requests.HTTPError as he:
        logger.error(f"OpenAI HTTP error: {he.response.status_code}")
        raise HTTPException(
            status_code=502,
            detail="External API error. Please try again later."
        )
    except Exception as e:
        logger.error(f"Unexpected error in solve_chatgpt: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occurred")

# ---------------------------


# ---------------------------


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """
    Serve the frontend static files (SPA).
    If a file exists, serve it. Otherwise, serve index.html.
    """
    # Define the static directory (mapped in Dockerfile)
    static_dir = os.path.join(os.getcwd(), "static")
    
    if os.path.isdir(static_dir):
        # 1. Try to serve exact file from static directory
        target_file = os.path.join(static_dir, full_path)
        if os.path.exists(target_file) and os.path.isfile(target_file):
            return FileResponse(target_file)
        
        # 2. SPA Fallback: serve index.html for client-side routing
        index_file = os.path.join(static_dir, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
    
    # Fallback message if static files are not present (e.g. local dev)
    return {
        "message": "Backend running. POST to /solve-gemini or /solve-perplexity. Static files not found (dev mode)."
    }

