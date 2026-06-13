const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requireAdminAuth } = require('../middleware/auth');
const { query, codingQuestionToApi } = require('../db/postgres');
const XLSX = require('xlsx');

router.use(requireAdminAuth);

router.get('/settings', async (req, res) => {
  const result = await query('select * from coding_settings where id = $1', ['settings']);
  const s = result.rows[0] || {};
  res.json({
    durationMinutes: s.duration_minutes,
    startTime: s.start_time,
    endTime: s.end_time,
    isActive: s.is_active,
    allowedLanguages: (s.allowed_languages || ['python', 'java', 'c', 'cpp']).filter((lang) => lang !== 'javascript'),
    maxViolationsBeforeSubmit: s.max_violations_before_submit,
    executionTimeoutMs: s.execution_timeout_ms,
  });
});

router.put('/settings',
  [
    body('durationMinutes').isInt({ min: 1, max: 480 }),
    body('isActive').isBoolean(),
    body('allowedLanguages').isArray(),
    body('executionTimeoutMs').isInt({ min: 1000, max: 30000 }),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid settings' });
    const result = await query(
      `update coding_settings
       set duration_minutes = $1, is_active = $2, allowed_languages = $3,
           execution_timeout_ms = $4, max_violations_before_submit = $5, updated_at = now()
       where id = 'settings'
       returning *`,
      [
        req.body.durationMinutes,
        req.body.isActive,
        JSON.stringify(req.body.allowedLanguages),
        req.body.executionTimeoutMs,
        req.body.maxViolationsBeforeSubmit || 2,
      ]
    );
    const s = result.rows[0];
    res.json({
      durationMinutes: s.duration_minutes,
      isActive: s.is_active,
      allowedLanguages: s.allowed_languages,
      maxViolationsBeforeSubmit: s.max_violations_before_submit,
      executionTimeoutMs: s.execution_timeout_ms,
    });
  }
);

router.get('/questions', async (req, res) => {
  const result = await query('select * from coding_questions order by order_no asc');
  res.json({ questions: result.rows.map((row) => codingQuestionToApi(row, true)) });
});

router.get('/questions/:id', async (req, res) => {
  const result = await query('select * from coding_questions where id = $1', [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(codingQuestionToApi(row, true));
});

router.post('/questions',
  [
    body('order').isInt({ min: 1, max: 20 }),
    body('title').trim().isLength({ min: 1, max: 200 }),
    body('description').trim().isLength({ min: 1, max: 5000 }),
    body('inputFormat').trim().isLength({ min: 1, max: 1000 }),
    body('outputFormat').trim().isLength({ min: 1, max: 1000 }),
    body('constraints').trim().isLength({ min: 1, max: 1000 }),
    body('testCases').isArray({ min: 1 }),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid question data' });
    try {
      const testCases = req.body.testCases || [];
      const totalMarks = testCases.reduce((sum, tc) => sum + Number(tc.marks || 0), 0);
      const result = await query(
        `insert into coding_questions
         (order_no, title, description, input_format, output_format, constraints_text,
          sample_input, sample_output, test_cases, total_marks, is_active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning *`,
        [
          req.body.order,
          req.body.title,
          req.body.description,
          req.body.inputFormat,
          req.body.outputFormat,
          req.body.constraints,
          req.body.sampleInput || '',
          req.body.sampleOutput || '',
          JSON.stringify(testCases),
          totalMarks,
          req.body.isActive !== false,
        ]
      );
      res.status(201).json(codingQuestionToApi(result.rows[0], true));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

router.put('/questions/:id', async (req, res) => {
  try {
    const testCases = req.body.testCases || [];
    const totalMarks = testCases.reduce((sum, tc) => sum + Number(tc.marks || 0), 0);
    const result = await query(
      `update coding_questions
       set order_no = $1, title = $2, description = $3, input_format = $4,
           output_format = $5, constraints_text = $6, sample_input = $7,
           sample_output = $8, test_cases = $9, total_marks = $10,
           is_active = $11, updated_at = now()
       where id = $12
       returning *`,
      [
        req.body.order,
        req.body.title,
        req.body.description,
        req.body.inputFormat,
        req.body.outputFormat,
        req.body.constraints,
        req.body.sampleInput || '',
        req.body.sampleOutput || '',
        JSON.stringify(testCases),
        totalMarks,
        req.body.isActive !== false,
        req.params.id,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(codingQuestionToApi(result.rows[0], true));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/questions/:id', async (req, res) => {
  await query('delete from coding_questions where id = $1', [req.params.id]);
  res.json({ success: true });
});

router.delete('/exam/reset', async (req, res) => {
  try {
    await query('delete from coding_submissions');
    await query('delete from coding_students');
    await query('delete from coding_questions');
    await query(
      `update coding_settings
       set is_active = false, duration_minutes = 60, execution_timeout_ms = 5000,
           allowed_languages = '["python","java","c","cpp"]',
           max_violations_before_submit = 2, updated_at = now()
       where id = 'settings'`
    );
    res.json({ success: true, message: 'Coding exam deleted and reset.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete coding exam.' });
  }
});

router.get('/students', async (req, res) => {
  const result = await query('select * from coding_students order by created_at desc');
  res.json({
    students: result.rows.map((s) => ({
      _id: s.id,
      rollNumber: s.roll_number,
      fullName: s.full_name,
      ipAddress: s.ip_address,
      loginTime: s.login_time,
      examStartTime: s.exam_start_time,
      examSubmittedAt: s.exam_submitted_at,
      hasAttempted: s.has_attempted,
      isLoggedIn: s.is_logged_in,
      status: s.status,
      totalViolations: s.total_violations,
      autoSubmitted: s.auto_submitted,
      autoSubmitReason: s.auto_submit_reason,
    })),
  });
});

router.get('/results', async (req, res) => {
  try {
    const students = (await query('select * from coding_students where has_attempted = true order by created_at desc')).rows;
    const submissions = (await query(`
      select s.*, q.order_no, q.title
      from coding_submissions s
      left join coding_questions q on q.id = s.question_id
    `)).rows;

    const results = students.map((student) => {
      const subs = submissions.filter((sub) => sub.student_id === student.id);
      const totalScore = subs.reduce((sum, sub) => sum + sub.score, 0);
      const maxScore = subs.reduce((sum, sub) => sum + sub.max_score, 0);
      return {
        _id: student.id,
        rollNumber: student.roll_number,
        fullName: student.full_name,
        ipAddress: student.ip_address,
        loginTime: student.login_time,
        submittedAt: student.exam_submitted_at,
        status: student.status,
        totalViolations: student.total_violations,
        autoSubmitted: student.auto_submitted,
        totalScore,
        maxScore,
        submissions: subs.map((sub) => ({
          questionId: sub.question_id,
          questionOrder: sub.order_no,
          questionTitle: sub.title,
          testCasesPassed: sub.test_cases_passed,
          totalTestCases: sub.total_test_cases,
          score: sub.score,
          maxScore: sub.max_score,
          submittedAt: sub.submitted_at,
          language: sub.language,
        })),
      };
    }).sort((a, b) => b.totalScore - a.totalScore);

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get results' });
  }
});

router.get('/results/:studentId/code/:questionId', async (req, res) => {
  const result = await query(
    `select s.*, q.title, q.order_no
     from coding_submissions s
     left join coding_questions q on q.id = s.question_id
     where s.student_id = $1 and s.question_id = $2`,
    [req.params.studentId, req.params.questionId]
  );
  const sub = result.rows[0];
  if (!sub) return res.status(404).json({ error: 'Not found' });
  res.json({
    _id: sub.id,
    student: sub.student_id,
    question: { _id: sub.question_id, title: sub.title, order: sub.order_no },
    code: sub.code,
    language: sub.language,
    testResults: sub.test_results,
    testCasesPassed: sub.test_cases_passed,
    totalTestCases: sub.total_test_cases,
    score: sub.score,
    maxScore: sub.max_score,
    submittedAt: sub.submitted_at,
  });
});

router.delete('/students/:studentId/reset', async (req, res) => {
  try {
    const studentResult = await query('select * from coding_students where id = $1', [req.params.studentId]);
    const student = studentResult.rows[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });

    await query('delete from coding_submissions where student_id = $1', [req.params.studentId]);
    await query(
      `update coding_students
       set status = 'registered', has_attempted = false, is_logged_in = false,
           session_id = null, exam_start_time = null, exam_submitted_at = null,
           auto_submit_reason = null, auto_submitted = false, violations = '[]',
           total_violations = 0, updated_at = now()
       where id = $1`,
      [req.params.studentId]
    );

    res.json({ success: true, message: `${student.full_name} has been reset. They can now re-attempt the exam.` });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

router.get('/monitor', async (req, res) => {
  const result = await query(
    `select roll_number, full_name, status, total_violations, is_logged_in, exam_start_time, login_time
     from coding_students
     where has_attempted = true
     order by login_time desc`
  );
  res.json({
    students: result.rows.map((s) => ({
      rollNumber: s.roll_number,
      fullName: s.full_name,
      status: s.status,
      totalViolations: s.total_violations,
      isLoggedIn: s.is_logged_in,
      examStartTime: s.exam_start_time,
      loginTime: s.login_time,
    })),
    timestamp: new Date(),
  });
});

router.get('/export/results', async (req, res) => {
  try {
    const students = (await query('select * from coding_students where has_attempted = true')).rows;
    const submissions = (await query(`
      select s.*, q.order_no, q.title
      from coding_submissions s
      left join coding_questions q on q.id = s.question_id
    `)).rows;
    const questions = (await query('select * from coding_questions where is_active = true order by order_no asc')).rows;

    const data = students.map((student) => {
      const subs = submissions.filter((sub) => sub.student_id === student.id);
      const totalScore = subs.reduce((sum, sub) => sum + sub.score, 0);
      const row = {
        'Roll Number': student.roll_number,
        'Full Name': student.full_name,
        'IP Address': student.ip_address,
        'Login Time': student.login_time ? new Date(student.login_time).toLocaleString() : '',
        'Submitted At': student.exam_submitted_at ? new Date(student.exam_submitted_at).toLocaleString() : '',
        Status: student.status,
        'Total Violations': student.total_violations,
        'Auto Submitted': student.auto_submitted ? 'Yes' : 'No',
        'Total Score': totalScore,
      };
      questions.forEach((q) => {
        const sub = subs.find((s) => s.question_id === q.id);
        row[`Q${q.order_no} Score`] = sub ? sub.score : 0;
        row[`Q${q.order_no} Passed`] = sub ? `${sub.test_cases_passed}/${sub.total_test_cases}` : '0/0';
      });
      return row;
    }).sort((a, b) => b['Total Score'] - a['Total Score']);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Results');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=exam_results_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/export/logins', async (req, res) => {
  const students = (await query('select * from coding_students')).rows;
  const data = students.map((s) => ({
    'Roll Number': s.roll_number,
    'Full Name': s.full_name,
    'IP Address': s.ip_address || '',
    'Login Time': s.login_time ? new Date(s.login_time).toLocaleString() : 'Not logged in',
    'Has Attempted': s.has_attempted ? 'Yes' : 'No',
    Status: s.status,
    'Total Violations': s.total_violations,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Login Data');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=login_data.xlsx');
  res.send(buffer);
});

module.exports = router;
