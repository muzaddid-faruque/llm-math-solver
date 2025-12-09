# LLM Math Solver

[![Python CI](https://github.com/muzaddid-faruque/llm-math-solver/actions/workflows/python-ci.yml/badge.svg)](https://github.com/muzaddid-faruque/llm-math-solver/actions/workflows/python-ci.yml)
[![License](https://img.shields.io/github/license/muzaddid-faruque/llm-math-solver.svg)](LICENSE)

A full-stack application that solves mathematical problems from images using Large Language Models (LLMs). Upload an image containing a math problem and get step-by-step solutions with beautifully rendered LaTeX equations, powered by your choice of AI provider: Google Gemini, Perplexity, or OpenAI ChatGPT.

## Features

- **Modern UI Design** - Beautiful glassmorphism interface with gradient cards and smooth animations
- **Multi-LLM Support** - Choose between Google Gemini, Perplexity Sonar, or OpenAI ChatGPT
- **Image-to-Solution** - Upload images of handwritten or printed math problems
- **Step-by-Step Solutions** - Get detailed solving process with explanations
- **LaTeX Rendering** - Beautiful mathematical expression display using KaTeX
- **Cross-Platform Frontend** - Works on Web, iOS, and Android via React Native + Expo
- **Dark Gradient Theme** - Professional dark blue gradient background with vibrant accent colors
- **Icon-Enhanced Buttons** - Each AI provider has unique gradient colors and icons
- **Robust JSON Parsing** - Handles various response formats from different LLM providers
- **Debug Mode** - View raw API responses for troubleshooting

## Project Structure

```
llm-math-solver/
├── backend/                      # FastAPI Python backend
│   ├── main.py                   # Main application with API endpoints
│   ├── requirements.txt          # Python dependencies
│   ├── .env.example              # Environment variables template
│   └── venv/                     # Virtual environment (local)
│
├── frontend/                     # React Native + Expo frontend
│   └── math-llm-frontend/
│       ├── app/                  # Application screens (Expo Router)
│       │   ├── (tabs)/
│       │   │   ├── index.tsx     # Main solver screen
│       │   │   ├── explore.tsx   # Documentation screen
│       │   │   └── _layout.tsx   # Tab navigation
│       │   └── _layout.tsx       # Root layout
│       ├── components/           # Reusable React components
│       ├── constants/            # Theme and constants
│       ├── hooks/                # Custom React hooks
│       ├── assets/               # Images and media
│       └── package.json          # Dependencies
│
├── .github/
│   └── workflows/
│       └── python-ci.yml         # CI/CD pipeline
│
├── LICENSE                       # MIT License
└── README.md                     # This file
```

## Technology Stack

### Backend
- **FastAPI** - Modern Python web framework
- **Uvicorn** - ASGI server
- **Google GenAI SDK** - For Gemini API integration
- **Requests** - For Perplexity and OpenAI API calls
- **Python-dotenv** - Environment variable management
- **Python-multipart** - File upload handling

### Frontend
- **React Native** 0.81.5 - Cross-platform mobile framework
- **Expo** ~54.0.25 - Development platform
- **Expo Router** - File-based routing
- **TypeScript** - Type safety
- **React Navigation** - Navigation library
- **KaTeX** - LaTeX rendering engine
- **React Native WebView** - Native LaTeX display
- **Expo Image Picker** - Gallery image selection
- **Expo Linear Gradient** - Gradient backgrounds and buttons
- **Expo Vector Icons** - Icon library (Ionicons, MaterialCommunityIcons)

### LLM APIs
- **Google Gemini** - gemini-2.5-flash-image model
- **Perplexity** - sonar-pro model
- **OpenAI** - gpt-4o-mini (configurable)

## Getting Started

### Prerequisites

- **Backend:**
  - Python 3.10 or 3.11
  - pip (Python package installer)

- **Frontend:**
  - Node.js v16 or higher
  - npm or yarn

- **API Keys:**
  - At least one of: Google Gemini API key, Perplexity API key, or OpenAI API key

### Backend Setup

1. **Navigate to the backend directory**

   ```bash
   cd backend
   ```

2. **Create and configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your API keys:

   ```env
   PERPLEXITY_API_KEY=pplx-your-key-here
   GEMINI_API_KEY=your-gemini-key-here
   OPENAI_API_KEY=sk-your-openai-key-here
   OPENAI_MODEL=gpt-4o-mini  # Optional: Override default model
   ```

   To get API keys:
   - **Gemini**: Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - **Perplexity**: Visit [Perplexity API](https://www.perplexity.ai/settings/api)
   - **OpenAI**: Visit [OpenAI Platform](https://platform.openai.com/api-keys)

3. **Create a virtual environment (recommended)**

   ```bash
   python -m venv venv

   # Windows
   venv\Scripts\activate

   # macOS/Linux
   source venv/bin/activate
   ```

4. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

5. **Run the backend server**

   **Option 1: Using the startup script (Recommended for Windows)**
   ```bash
   .\start_backend.bat
   ```

   **Option 2: Using uvicorn directly (ensure venv is activated)**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   **Note**: If you encounter "Module not found" errors, make sure the virtual environment is activated and all dependencies are installed.

   The backend will be available at `http://localhost:8000`

### Frontend Setup

1. **Navigate to the frontend directory**

   ```bash
   cd frontend/math-llm-frontend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the development server**

   ```bash
   npx expo start
   ```

4. **Open the app**

   In the terminal output, you'll find options:
   - Press `w` to open in **web browser**
   - Press `a` to open in **Android emulator**
   - Press `i` to open in **iOS simulator**
   - Scan QR code with **Expo Go** app on your phone

## Usage

1. **Start the backend server** (see Backend Setup above)

2. **Launch the frontend app** (see Frontend Setup above)

3. **Configure Backend URL** (if needed)
   - Default: `http://localhost:8000`
   - Update in the app if your backend runs on a different address

4. **Upload an Image**
   - Click "Pick an Image From PC" button
   - Select an image containing a math problem

5. **Choose an LLM Provider**
   - **Solve with Gemini** - Google's Gemini 2.5 Flash Image model
   - **Solve with Perplexity** - Perplexity Sonar Pro model
   - **Solve with ChatGPT** - OpenAI's GPT-4o-mini

6. **View the Solution**
   - Extracted math expression (LaTeX formatted)
   - Step-by-step solution
   - Final answer
   - Any notes or ambiguities

## API Endpoints

### GET /
Health check endpoint that returns a welcome message.

**Response:**
```json
{
  "message": "Welcome to the LLM Math Solver API",
  "endpoints": ["/solve-gemini", "/solve-perplexity", "/solve-chatgpt"]
}
```

### POST /solve-gemini
Solve a math problem using Google Gemini.

**Request:**
- `file` (multipart/form-data): Image file containing the math problem

**Response:**
```json
{
  "latex": "\\int_{0}^{\\pi} \\sin(x) \\, dx",
  "answer": "2",
  "steps": [
    "Step 1: Identify the integral",
    "Step 2: Apply the antiderivative",
    "Step 3: Evaluate at bounds"
  ],
  "notes": ""
}
```

### POST /solve-perplexity
Solve a math problem using Perplexity Sonar.

**Request:**
- `file` (multipart/form-data): Image file containing the math problem

**Response:** Same format as `/solve-gemini`

### POST /solve-chatgpt
Solve a math problem using OpenAI ChatGPT.

**Request:**
- `file` (multipart/form-data): Image file containing the math problem

**Response:** Same format as `/solve-gemini`

## Development

### Running Tests

```bash
cd backend
pytest
```

### Linting

```bash
cd backend
flake8 .
```

### CI/CD

The project uses GitHub Actions for continuous integration:
- Runs on pushes and pull requests to `main`
- Tests on Python 3.10 and 3.11
- Performs linting with flake8
- Runs pytest tests

See [.github/workflows/python-ci.yml](.github/workflows/python-ci.yml) for details.

### Frontend Development

- Edit [app/(tabs)/index.tsx](frontend/math-llm-frontend/app/(tabs)/index.tsx) to modify the main solver screen
- The app uses file-based routing via Expo Router
- Hot reloading is enabled for rapid development
- TypeScript provides type safety

## How It Works

### Backend Flow

1. Client uploads an image via multipart/form-data
2. Backend converts image to appropriate format (bytes or base64)
3. Image and prompt are sent to selected LLM API
4. LLM analyzes the image and extracts the math problem
5. LLM solves the problem and returns structured JSON
6. Backend parses and forwards the response to the client

### Frontend Flow

1. User selects an image from their device gallery
2. Image is sent to backend with selected LLM provider
3. App displays loading state during processing
4. Response is parsed and cleaned (JSON extraction, LaTeX formatting)
5. Math expressions are rendered using MathJax
6. Solution is displayed with proper formatting

### LaTeX Rendering

- **Web**: Uses MathJax 3 loaded via CDN
- **iOS/Android**: Uses WebView with embedded MathJax HTML
- Supports both inline and display math modes
- Automatic height adjustment based on content

## Troubleshooting

### Backend Issues

**Issue: API key errors**
- Ensure `.env` file exists in the `backend/` directory
- Verify API keys are correct and active
- Check that keys have proper permissions

**Issue: CORS errors**
- Backend has CORS enabled for all origins (development mode)
- For production, update CORS settings in `main.py`

### Frontend Issues

**Issue: Cannot connect to backend**
- Verify backend is running on the expected URL
- Update backend URL in the app settings
- Check firewall settings

**Issue: LaTeX not rendering**
- Ensure internet connection (MathJax loads from CDN)
- Check browser console for errors
- Try toggling debug mode to view raw responses

**Issue: Image picker not working**
- Grant necessary permissions for gallery access
- On iOS simulator, add images to Photos library first
- On Android emulator, ensure storage permissions are granted

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Google Gemini API for image-to-text math solving
- Perplexity AI for their Sonar API
- OpenAI for ChatGPT API
- MathJax for beautiful LaTeX rendering
- Expo team for the amazing React Native development experience

## Support

If you encounter any issues or have questions, please:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review existing [GitHub Issues](https://github.com/muzaddid-faruque/llm-math-solver/issues)
3. Create a new issue with detailed information

## Roadmap

Potential future enhancements:
- Support for more LLM providers
- Handwriting recognition improvements
- Solution history and bookmarking
- Export solutions as PDF
- Support for multiple languages
- Web-based image capture via camera
- Offline mode with cached solutions

---

Made with dedication by [muzaddid-faruque](https://github.com/muzaddid-faruque)
