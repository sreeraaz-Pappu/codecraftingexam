# CodeCraftingExam

Combined secure exam platform built from:

- `exam-system`: MCQ/fill-in-the-blank exams with exam codes, admin exam management, image questions, scoring, and Excel export.
- `secure-exam-system`: secure coding exam workflow with session auth, code execution, anti-cheat logging, live monitor, admin coding-question management, and result export.

## Apps

Coding exam:

- Student login: `http://localhost:5000/`
- Student exam: `http://localhost:5000/exam`
- Admin login: `http://localhost:5000/admin`
- Admin dashboard: `http://localhost:5000/admin/dashboard`
- Coding questions: `http://localhost:5000/admin/questions`
- Coding results: `http://localhost:5000/admin/results`
- Live monitor: `http://localhost:5000/admin/monitor`

MCQ exam:

- MCQ admin login: `http://localhost:5000/mcq-admin`
- MCQ admin dashboard: `http://localhost:5000/mcq-admin/dashboard`
- MCQ student login: `http://localhost:5000/mcq-exam/:examCode/login`
- MCQ student instructions: `http://localhost:5000/mcq-exam/:examCode/instructions`
- MCQ student exam: `http://localhost:5000/mcq-exam/:examCode/exam`

## Setup

```bash
cd backend
npm install
copy .env.example .env
npm start
```

## Database

The merged app now runs in Supabase/Postgres mode. On startup, it initializes these tables in the Supabase `public` schema:

- `coding_settings`
- `coding_students`
- `coding_questions`
- `coding_submissions`
- `mcq_exams`
- `mcq_questions`
- `mcq_students`
- `mcq_responses`

Use these variables in `backend/.env`:

```env
DATABASE_PROVIDER=supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DATABASE_URL=
```

The old MongoDB mode is no longer needed for normal use. If you do use it later, provide:

```env
DATABASE_PROVIDER=mongodb
MONGODB_URI=
```
