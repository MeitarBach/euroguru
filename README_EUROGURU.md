# EuroGuru Web Application - Quick Start Guide

## 🚀 One-Command Startup

To fetch data and start both frontend and backend:

```bash
./run_euroguru.sh
```

This will:
1. ✅ Activate the Python virtual environment (`backend/venv`)
2. ✅ Fetch the latest data from the API
3. ✅ Start the backend server on `http://localhost:8000`
4. ✅ Start the frontend server on `http://localhost:5173`

Press `Ctrl+C` to stop all services.

---

## 📋 Manual Commands (Alternative)

If you prefer to run commands separately or need more control:

### 0. Activate Virtual Environment (Required)
```bash
source backend/venv/bin/activate
```

### 1. Fetch Data
```bash
cd backend
python run_dev_fetch.py
```

### 2. Start Backend
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Start Frontend (in a new terminal)
```bash
cd frontend
npm run dev
```

---

## 🔗 Access Points

- **Frontend UI**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs (FastAPI auto-generated)

---

## 🛠️ Requirements

### Backend
- Python 3.x
- Dependencies: `pip install -r backend/requirements.txt`
- A `backend/.env` file with `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, and optionally `BUCKET_NAME` (see `backend/.env.example`)

### Frontend
- Node.js and npm
- Dependencies: `npm install` (run once inside `frontend/`)

---

## 📝 Notes

- The fetch script updates data in the dev S3 bucket
- Backend runs with auto-reload enabled (changes will restart the server)
- Frontend runs with Vite's hot module replacement (instant updates)
- Both servers run in development mode
