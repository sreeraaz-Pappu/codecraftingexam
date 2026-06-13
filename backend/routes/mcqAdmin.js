const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const router = express.Router();
const { query, mcqExamToApi, mcqQuestionToApi } = require('../db/postgres');

function requireMcqAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ success: false, message: 'Admin authentication required' });
}

const uploadDir = path.join(__dirname, '../uploads/mcq-questions');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeBase = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, `${Date.now()}-${safeBase}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.mimetype)) {
      return cb(new Error('Only JPG and PNG images are allowed'));
    }
    cb(null, true);
  },
});

function parseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  if (typeof raw === 'string') return JSON.parse(raw);
  return [];
}

router.use(requireMcqAdmin);

router.get('/dashboard', async (req, res) => {
  try {
    const stats = await query(`
      select
        (select count(*)::int from mcq_exams) as total_exams,
        (select count(*)::int from mcq_students) as total_students,
        (select count(*)::int from mcq_responses) as total_responses,
        (select count(*)::int from mcq_exams where is_active = true) as active_exams
    `);
    const row = stats.rows[0];
    res.json({
      success: true,
      stats: {
        totalExams: row.total_exams,
        totalStudents: row.total_students,
        totalResponses: row.total_responses,
        activeExams: row.active_exams,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/exams', async (req, res) => {
  try {
    const result = await query(`
      select e.*,
        (select count(*)::int from mcq_questions q where q.exam_id = e.id) as question_count,
        (select count(*)::int from mcq_responses r where r.exam_id = e.id) as response_count
      from mcq_exams e
      order by e.created_at desc
    `);
    res.json({ success: true, exams: result.rows.map(mcqExamToApi) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/exams', async (req, res) => {
  try {
    const { examTitle, examCode, duration, instructions, isActive } = req.body;
    if (!examTitle || !examCode) {
      return res.status(400).json({ success: false, message: 'Title and code required.' });
    }
    const durationMinutes = Number(duration || 30);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
      return res.status(400).json({ success: false, message: 'Duration must be between 1 and 480 minutes.' });
    }
    const code = examCode.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const exists = await query('select id from mcq_exams where exam_code = $1', [code]);
    if (exists.rows[0]) return res.status(400).json({ success: false, message: 'Exam code already exists.' });
    const result = await query(
      `insert into mcq_exams (exam_title, exam_code, duration, is_active, instructions)
       values ($1,$2,$3,$4,$5) returning *`,
      [examTitle, code, durationMinutes, !!isActive, instructions || '']
    );
    res.json({ success: true, exam: mcqExamToApi(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/exams/:id', async (req, res) => {
  try {
    const { examTitle, duration, isActive, instructions } = req.body;
    if (!examTitle || !Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 480) {
      return res.status(400).json({ success: false, message: 'Valid title and duration are required.' });
    }
    const result = await query(
      `update mcq_exams
       set exam_title = $1, duration = $2, is_active = $3, instructions = $4, updated_at = now()
       where id = $5 returning *`,
      [examTitle, duration, isActive, instructions || '', req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Exam not found.' });
    res.json({ success: true, exam: mcqExamToApi(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/exams/:id', async (req, res) => {
  try {
    await query('delete from mcq_exams where id = $1', [req.params.id]);
    res.json({ success: true, message: 'Exam and related data deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/exams/:examId/questions', async (req, res) => {
  try {
    const result = await query(
      'select * from mcq_questions where exam_id = $1 order by order_no asc, created_at asc',
      [req.params.examId]
    );
    res.json({ success: true, questions: result.rows.map((row) => mcqQuestionToApi(row, true)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/exams/:examId/questions', upload.single('questionImage'), async (req, res) => {
  try {
    const { questionText, questionType, correctAnswer, marks, order } = req.body;
    const options = parseOptions(req.body.options);
    if (!questionText || !['mcq', 'fill'].includes(questionType)) {
      return res.status(400).json({ success: false, message: 'Valid question text and type are required.' });
    }
    if (questionType === 'mcq' && options.length < 2) {
      return res.status(400).json({ success: false, message: 'MCQ questions require at least two options.' });
    }
    if (questionType === 'fill' && !correctAnswer) {
      return res.status(400).json({ success: false, message: 'Fill questions require a correct answer.' });
    }
    const questionImage = req.file ? `/uploads/mcq-questions/${req.file.filename}` : null;
    const result = await query(
      `insert into mcq_questions
       (exam_id, question_text, question_type, options, correct_answer, marks, order_no, question_image)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [req.params.examId, questionText, questionType, JSON.stringify(options), correctAnswer, marks, order, questionImage]
    );
    res.json({ success: true, question: mcqQuestionToApi(result.rows[0], true) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/questions/:id', upload.single('questionImage'), async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.body.options) updateData.options = parseOptions(req.body.options);
    if (req.file) updateData.questionImage = `/uploads/mcq-questions/${req.file.filename}`;

    const current = (await query('select * from mcq_questions where id = $1', [req.params.id])).rows[0];
    if (!current) return res.status(404).json({ success: false, message: 'Question not found' });

    const result = await query(
      `update mcq_questions
       set question_text = $1, question_type = $2, options = $3, correct_answer = $4,
           marks = $5, order_no = $6, question_image = $7, updated_at = now()
       where id = $8 returning *`,
      [
        updateData.questionText ?? current.question_text,
        updateData.questionType ?? current.question_type,
        JSON.stringify(updateData.options ?? current.options ?? []),
        updateData.correctAnswer ?? current.correct_answer,
        updateData.marks ?? current.marks,
        updateData.order ?? current.order_no,
        updateData.questionImage ?? current.question_image,
        req.params.id,
      ]
    );
    res.json({ success: true, question: mcqQuestionToApi(result.rows[0], true) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/questions/:id', async (req, res) => {
  try {
    await query('delete from mcq_questions where id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/exams/:examId/results', async (req, res) => {
  try {
    const result = await query(
      'select * from mcq_responses where exam_id = $1 order by total_marks desc',
      [req.params.examId]
    );
    res.json({
      success: true,
      results: result.rows.map((r) => ({
        _id: r.id,
        examId: r.exam_id,
        studentId: r.student_id,
        rollNumber: r.roll_number,
        fullName: r.full_name,
        answers: r.answers,
        totalMarks: r.total_marks,
        maxMarks: r.max_marks,
        percentage: r.percentage,
        submittedAt: r.submitted_at,
        submissionType: r.submission_type,
        tabSwitchCount: r.tab_switch_count,
        fullscreenExitCount: r.fullscreen_exit_count,
        timeTakenSeconds: r.time_taken_seconds,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/results/:id', async (req, res) => {
  try {
    const response = (await query('select * from mcq_responses where id = $1', [req.params.id])).rows[0];
    if (!response) return res.status(404).json({ success: false, message: 'Response not found' });
    await query(
      'update mcq_students set has_attempted = false, exam_start_time = null, updated_at = now() where exam_id = $1 and roll_number = $2',
      [response.exam_id, response.roll_number]
    );
    await query('delete from mcq_responses where id = $1', [req.params.id]);
    res.json({ success: true, message: 'Response deleted. Student can retake.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/exams/:examId/export', async (req, res) => {
  try {
    const exam = (await query('select * from mcq_exams where id = $1', [req.params.examId])).rows[0];
    const results = (await query(
      'select * from mcq_responses where exam_id = $1 order by total_marks desc',
      [req.params.examId]
    )).rows;
    const data = results.map((r, i) => {
      const row = {
      Rank: i + 1,
      'Roll No': r.roll_number,
      Name: r.full_name,
      Score: r.total_marks,
      'Max Marks': r.max_marks,
      Percent: r.percentage,
      'Submitted At': r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '',
      Type: r.submission_type,
      'Tab Switches': r.tab_switch_count,
      'Fullscreen Exits': r.fullscreen_exit_count,
      'Time Seconds': r.time_taken_seconds,
      };
      (r.answers || []).forEach((answer, index) => {
        row[`Q${index + 1} Question`] = answer.questionText || '';
        row[`Q${index + 1} Answer`] = answer.givenAnswer || '';
        row[`Q${index + 1} Correct`] = answer.isCorrect ? 'Yes' : 'No';
        row[`Q${index + 1} Marks`] = answer.marksAwarded || 0;
      });
      return row;
    });
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename=${exam?.exam_code || 'mcq'}_results.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
