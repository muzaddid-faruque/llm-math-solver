import os, base64, json
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import requests

load_dotenv()
app = FastAPI()

# ---- CORS (allow requests from your Expo dev server / phone)
origins = [
    "http://localhost",
    "http://localhost:19006",
    "http://127.0.0.1",
    # add your PC LAN IP (example: "http://192.168.0.101")
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # during development it's OK to use "*" — tighten this for production
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
- "steps": a numbered step-by-step solution
- "notes": ambiguous interpretations if any
Do not add any text outside the JSON.
"""

def to_b64(b: bytes) -> str:
    return base64.b64encode(b).decode("utf-8")

@app.post("/solve-perplexity")
async def solve_perplexity(file: UploadFile = File(...)):
    if not PERPLEXITY_API_KEY:
        return {"error": "PERPLEXITY_API_KEY not set in .env"}

    img = await file.read()
    b64 = to_b64(img)

    url = "https://api.perplexity.ai/chat/completions"
    headers = {
        "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
        "Content-Type": "application/json"
    }

    body = {
        "model": "pplx-sonar",
        "messages": [
            {"role": "user", "content": LLM_PROMPT}
        ],
        "attachments": [
            {
                "type": "image",
                "mime_type": file.content_type,
                "data": b64,
                "filename": file.filename
            }
        ],
        "max_tokens": 1500
    }

    r = requests.post(url, headers=headers, data=json.dumps(body))
    r.raise_for_status()
    return r.json()

@app.post("/solve-gemini")
async def solve_gemini(file: UploadFile = File(...)):
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not set in .env"}

    img = await file.read()
    b64 = to_b64(img)

    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)

        contents = [
            {"type": "image", "image": {"data": b64, "mime_type": file.content_type}},
            {"type": "text", "text": LLM_PROMPT}
        ]

        resp = client.models.generate_content(
            model="gemini-1.5-flash",
            contents=contents,
            temperature=0.2,
            max_output_tokens=1500
        )

        return {"raw": getattr(resp, "text", str(resp))}

    except Exception as e:
        return {"error": "Gemini SDK error", "detail": str(e)}

@app.get("/")
async def root():
    return {"message": "Backend running. POST to /solve-gemini or /solve-perplexity"}
