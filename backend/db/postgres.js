const { Pool } = require('pg');

const connectionString = process.env.SUPABASE_DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

async function initSchema() {
  await query('create extension if not exists "pgcrypto"');

  await query(`
    create table if not exists coding_settings (
      id text primary key default 'settings',
      duration_minutes integer not null default 60,
      start_time timestamptz,
      end_time timestamptz,
      is_active boolean not null default false,
      allowed_languages jsonb not null default '["python","java","c","cpp"]',
      max_violations_before_submit integer not null default 2,
      execution_timeout_ms integer not null default 5000,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    insert into coding_settings (id)
    values ('settings')
    on conflict (id) do nothing
  `);

  await query(`
    create table if not exists coding_students (
      id uuid primary key default gen_random_uuid(),
      roll_number text not null unique,
      full_name text not null,
      ip_address text,
      login_time timestamptz,
      exam_start_time timestamptz,
      exam_submitted_at timestamptz,
      has_attempted boolean not null default false,
      is_logged_in boolean not null default false,
      session_id text,
      status text not null default 'registered',
      violations jsonb not null default '[]',
      total_violations integer not null default 0,
      auto_submitted boolean not null default false,
      auto_submit_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists coding_questions (
      id uuid primary key default gen_random_uuid(),
      order_no integer not null unique,
      title text not null,
      description text not null,
      input_format text not null,
      output_format text not null,
      constraints_text text not null,
      sample_input text,
      sample_output text,
      test_cases jsonb not null default '[]',
      total_marks integer not null default 0,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists coding_submissions (
      id uuid primary key default gen_random_uuid(),
      student_id uuid not null references coding_students(id) on delete cascade,
      question_id uuid not null references coding_questions(id) on delete cascade,
      code text not null,
      language text not null default 'python',
      test_results jsonb not null default '[]',
      test_cases_passed integer not null default 0,
      total_test_cases integer not null default 0,
      score integer not null default 0,
      max_score integer not null default 0,
      submitted_at timestamptz not null default now(),
      execution_status text not null default 'pending',
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(student_id, question_id)
    )
  `);

  await query(`
    create table if not exists mcq_exams (
      id uuid primary key default gen_random_uuid(),
      exam_code text not null unique,
      exam_title text not null,
      duration integer not null default 30,
      is_active boolean not null default false,
      instructions text not null default 'Read all questions carefully before answering.',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists mcq_questions (
      id uuid primary key default gen_random_uuid(),
      exam_id uuid not null references mcq_exams(id) on delete cascade,
      question_text text not null,
      question_type text not null,
      options jsonb not null default '[]',
      correct_answer text not null,
      marks integer not null default 1,
      order_no integer not null default 0,
      question_image text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create table if not exists mcq_students (
      id uuid primary key default gen_random_uuid(),
      exam_id uuid not null references mcq_exams(id) on delete cascade,
      roll_number text not null,
      full_name text not null,
      has_attempted boolean not null default false,
      login_time timestamptz,
      exam_start_time timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(exam_id, roll_number)
    )
  `);

  await query(`
    create table if not exists mcq_responses (
      id uuid primary key default gen_random_uuid(),
      exam_id uuid not null references mcq_exams(id) on delete cascade,
      student_id uuid references mcq_students(id) on delete set null,
      roll_number text,
      full_name text,
      answers jsonb not null default '[]',
      total_marks integer not null default 0,
      max_marks integer not null default 0,
      percentage integer not null default 0,
      submitted_at timestamptz not null default now(),
      submission_type text not null default 'manual',
      tab_switch_count integer not null default 0,
      fullscreen_exit_count integer not null default 0,
      exam_start_time timestamptz,
      exam_end_time timestamptz,
      time_taken_seconds integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

function codingQuestionToApi(row, includeTests = false) {
  const question = {
    _id: row.id,
    order: row.order_no,
    title: row.title,
    description: row.description,
    inputFormat: row.input_format,
    outputFormat: row.output_format,
    constraints: row.constraints_text,
    sampleInput: row.sample_input || '',
    sampleOutput: row.sample_output || '',
    totalMarks: row.total_marks,
    isActive: row.is_active,
    testCaseCount: Array.isArray(row.test_cases) ? row.test_cases.length : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeTests) question.testCases = row.test_cases || [];
  return question;
}

function mcqExamToApi(row) {
  return {
    _id: row.id,
    examCode: row.exam_code,
    examTitle: row.exam_title,
    duration: row.duration,
    isActive: row.is_active,
    instructions: row.instructions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questionCount: row.question_count,
    responseCount: row.response_count,
  };
}

function mcqQuestionToApi(row, includeAnswer = true) {
  const question = {
    _id: row.id,
    examId: row.exam_id,
    questionText: row.question_text,
    questionType: row.question_type,
    options: row.options || [],
    marks: row.marks,
    order: row.order_no,
    questionImage: row.question_image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeAnswer) question.correctAnswer = row.correct_answer;
  return question;
}

module.exports = {
  pool,
  query,
  initSchema,
  codingQuestionToApi,
  mcqExamToApi,
  mcqQuestionToApi,
};
