const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requireStudentAuth } = require('../middleware/auth');
const { query, codingQuestionToApi } = require('../db/postgres');
const { executeCode, getAvailableLanguages } = require('../utils/codeExecutor');

router.get('/questions', requireStudentAuth, async (req, res) => {
  try {
    if (req.student.status === 'submitted' || req.student.status === 'auto_submitted') {
      return res.status(403).json({ error: 'Exam already submitted' });
    }
    const result = await query(
      'select * from coding_questions where is_active = true order by order_no asc'
    );
    res.json({ success: true, questions: result.rows.map((row) => codingQuestionToApi(row, false)) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load questions' });
  }
});

router.post('/run',
  requireStudentAuth,
  [
    body('code').isString().isLength({ min: 1, max: 50000 }),
    body('language').isIn(['python', 'java', 'c', 'cpp']),
    body('questionId').isString().notEmpty(),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    const { code, language, questionId } = req.body;
    try {
      if (req.student.status === 'submitted' || req.student.status === 'auto_submitted') {
        return res.status(403).json({ success: false, message: 'Exam already submitted' });
      }

      const questionResult = await query(
        'select sample_input, sample_output from coding_questions where id = $1',
        [questionId]
      );
      const question = questionResult.rows[0];
      if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

      const settingsResult = await query('select execution_timeout_ms from coding_settings where id = $1', ['settings']);
      const timeout = settingsResult.rows[0]?.execution_timeout_ms || 5000;
      const sampleTC = [{
        _id: 'sample',
        input: question.sample_input || '',
        expectedOutput: question.sample_output || '',
        marks: 0,
      }];
      const { results, error } = await executeCode(code, language, sampleTC, timeout);

      if (error) return res.json({ success: false, output: '', error, timedOut: false, passed: false });
      const r = results[0] || {};
      return res.json({
        success: true,
        output: r.stdout || '',
        error: r.error || null,
        timedOut: r.timedOut || false,
        passed: r.passed || false,
      });
    } catch (err) {
      console.error('Run error:', err);
      return res.status(500).json({ success: false, message: 'Execution failed' });
    }
  }
);

router.post('/submit/:questionId',
  requireStudentAuth,
  [
    body('code').isString().isLength({ min: 1, max: 50000 }),
    body('language').optional().isIn(['python', 'java', 'c', 'cpp']),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid input' });
    const { code, language = 'python' } = req.body;
    const { questionId } = req.params;
    try {
      if (req.student.status === 'submitted' || req.student.status === 'auto_submitted') {
        return res.status(403).json({ error: 'Exam already submitted' });
      }
      const elapsed = Date.now() - req.session.examStart;
      if (elapsed > req.session.durationMs) return res.status(403).json({ error: 'Exam time has expired' });

      const questionResult = await query('select * from coding_questions where id = $1 and is_active = true', [questionId]);
      const question = questionResult.rows[0];
      if (!question) return res.status(404).json({ error: 'Question not found' });

      const settingsResult = await query('select execution_timeout_ms from coding_settings where id = $1', ['settings']);
      const timeout = settingsResult.rows[0]?.execution_timeout_ms || 5000;
      const testCases = (question.test_cases || []).map((tc, index) => ({
        _id: tc._id || tc.id || `${question.id}-${index}`,
        input: tc.input,
        expectedOutput: tc.expectedOutput || tc.expected_output,
        marks: tc.marks,
      }));

      const { results, error } = await executeCode(code, language, testCases, timeout);
      if (error) return res.status(400).json({ error });

      const testCasesPassed = results.filter((r) => r.passed).length;
      const score = results.reduce((sum, r) => sum + r.marks, 0);
      const total = testCases.length;

      await query(
        `insert into coding_submissions
         (student_id, question_id, code, language, test_results, test_cases_passed, total_test_cases, score, max_score, submitted_at, execution_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'completed')
         on conflict (student_id, question_id)
         do update set code = excluded.code, language = excluded.language, test_results = excluded.test_results,
           test_cases_passed = excluded.test_cases_passed, total_test_cases = excluded.total_test_cases,
           score = excluded.score, max_score = excluded.max_score, submitted_at = now(),
           execution_status = 'completed', updated_at = now()`,
        [req.student.id, questionId, code, language, JSON.stringify(results), testCasesPassed, total, score, question.total_marks]
      );

      const safeResults = results.map((r, i) => ({
        index: i + 1,
        passed: r.passed,
        error: r.passed ? null : (r.error || 'Wrong Answer'),
      }));

      res.json({ success: true, passed: testCasesPassed, total, results: safeResults });
    } catch (err) {
      console.error('Submission error:', err);
      res.status(500).json({ error: 'Submission failed' });
    }
  }
);

router.post('/final-submit', requireStudentAuth, async (req, res) => {
  try {
    if (req.student.status === 'submitted' || req.student.status === 'auto_submitted') {
      return res.status(200).json({ success: true, message: 'Already submitted' });
    }
    const status = req.body.autoSubmit ? 'auto_submitted' : 'submitted';
    await query(
      `update coding_students
       set status = $1, exam_submitted_at = now(), is_logged_in = false, session_id = null,
           auto_submitted = $2, auto_submit_reason = $3, updated_at = now()
       where id = $4`,
      [status, !!req.body.autoSubmit, req.body.reason || null, req.student.id]
    );
    req.session.destroy();
    res.json({ success: true, message: 'Your response has been recorded.' });
  } catch (err) {
    res.status(500).json({ error: 'Submit failed' });
  }
});

router.post('/violation', requireStudentAuth,
  [body('type').isIn(['fullscreen_exit', 'tab_switch', 'right_click', 'keyboard_shortcut', 'copy_paste', 'other'])],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid' });
    const { type, details } = req.body;
    try {
      const violations = Array.isArray(req.student.violations) ? req.student.violations : [];
      let entry = violations.find((v) => v.type === type);
      if (entry) {
        entry.count += 1;
        entry.timestamps = [...(entry.timestamps || []), new Date().toISOString()];
        entry.details = details;
      } else {
        entry = { type, count: 1, timestamps: [new Date().toISOString()], details };
        violations.push(entry);
      }

      await query(
        'update coding_students set violations = $1, total_violations = total_violations + 1, updated_at = now() where id = $2',
        [JSON.stringify(violations), req.student.id]
      );

      const settingsResult = await query('select max_violations_before_submit from coding_settings where id = $1', ['settings']);
      const maxViolations = settingsResult.rows[0]?.max_violations_before_submit || 2;
      let shouldAutoSubmit = false;
      let warningMessage = null;
      if ((type === 'fullscreen_exit' || type === 'tab_switch') && entry.count >= maxViolations) {
        shouldAutoSubmit = true;
      } else if (entry.count === 1) {
        warningMessage = type === 'fullscreen_exit'
          ? 'WARNING: You exited fullscreen. Next violation will auto-submit your exam.'
          : 'WARNING: Tab switching detected. Next violation will auto-submit your exam.';
      }
      res.json({ success: true, shouldAutoSubmit, warningMessage, violationCount: entry.count });
    } catch (err) {
      res.status(500).json({ error: 'Failed to log violation' });
    }
  }
);

router.get('/settings', requireStudentAuth, async (req, res) => {
  try {
    const result = await query('select * from coding_settings where id = $1', ['settings']);
    const settings = result.rows[0];
    const elapsed = Date.now() - req.session.examStart;
    const remaining = Math.max(0, (req.session.durationMs || 3600000) - elapsed);
    res.json({
      durationMinutes: settings?.duration_minutes || 60,
      remainingMs: remaining,
      languages: getAvailableLanguages(settings?.allowed_languages || ['python', 'java', 'c', 'cpp']),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

module.exports = router;
