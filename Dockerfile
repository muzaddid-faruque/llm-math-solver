# Stage 1: Build the Frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app

# Copy frontend dependency files
COPY frontend/math-llm-frontend/package.json frontend/math-llm-frontend/package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the frontend source code
COPY frontend/math-llm-frontend/ ./

# Build the web assets
# Expo SDK 50+ uses 'dist' by default for web exports
RUN npx expo export -p web --output-dir dist

# Stage 2: Serve with Backend
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies if needed (e.g. for some python packages)
# RUN apt-get update && apt-get install -y ...

# Copy backend requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Copy built frontend assets from the previous stage
# We place them in a 'static' folder to be served by FastAPI
COPY --from=frontend-build /app/dist ./static

# Expose the port that Render expects (default 10000, but we use environment variable)
ENV PORT=10000
EXPOSE ${PORT}

# Run the application
# We use the PORT environment variable for Render
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
