const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { query, mcqQuestionToApi } = require('../db/postgres');

function verifyStudent(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ success: false, message: 'No token provided.' });
  try {
    req.student = jwt.verify(
      auth.split(' ')[1],
      process.env.JWT_SECRET || process.env.SESSION_SECRET || 'change_this_mcq_secret'
    );
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token. Please login again.' });
  }
}

router.get('/questions', verifyStudent, async (req, res) => {
  try {
    const student = (await query('select * from mcq_students where id = $1', [req.student.studentId])).rows[0];
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    if (student.has_attempted) {
      return res.status(403).json({ success: false, message: 'You have already submitted this exam.' });
    }

    if (!student.exam_start_time) {
      await query('update mcq_students set exam_start_time = now(), updated_at = now() where id = $1', [student.id]);
    }

    const result = await query(
      'select * from mcq_questions where exam_id = $1 order by order_no asc, created_at asc',
      [req.student.examId]
    );
    res.json({ success: true, questions: result.rows.map((row) => mcqQuestionToApi(row, false)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/submit', verifyStudent, async (req, res) => {
  try {
    const student = (await query('select * from mcq_students where id = $1', [req.student.studentId])).rows[0];
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    if (student.has_attempted) return res.status(403).json({ success: false, message: 'Already submitted.' });

    const { answers, submissionType, tabSwitchCount, fullscreenExitCount } = req.body;
    const exam = (await query('select * from mcq_exams where id = $1', [req.student.examId])).rows[0];
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    const questions = (await query('select * from mcq_questions where exam_id = $1', [req.student.examId])).rows;
    const questionsById = {};
    questions.forEach((q) => { questionsById[q.id] = q; });

    let totalMarks = 0;
    const maxMarks = questions.reduce((sum, q) => sum + Number(q.marks || 0), 0);
    const processedAnswers = (answers || []).map((answer) => {
      const q = questionsById[answer.questionId];
      if (!q) return null;
      const given = (answer.givenAnswer || '').toString().trim().toLowerCase();
      const correct = (q.correct_answer || '').toString().trim().toLowerCase();
      const isCorrect = given === correct;
      if (isCorrect) totalMarks += q.marks;
      return {
        questionId: q.id,
        questionText: q.question_text,
        givenAnswer: answer.givenAnswer || '',
        isCorrect,
        marksAwarded: isCorrect ? q.marks : 0,
      };
    }).filter(Boolean);

    const now = new Date();
    const timeTaken = student.exam_start_time ? Math.floor((now - student.exam_start_time) / 1000) : 0;
    const durationSeconds = Number(exam.duration || 30) * 60;
    const finalSubmissionType = timeTaken > durationSeconds + 5 ? 'auto_timer' : (submissionType || 'manual');

    await query(
      `insert into mcq_responses
       (exam_id, student_id, roll_number, full_name, answers, total_marks, max_marks, percentage,
        submission_type, tab_switch_count, fullscreen_exit_count, exam_start_time, exam_end_time, time_taken_seconds)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        req.student.examId,
        student.id,
        student.roll_number,
        student.full_name,
        JSON.stringify(processedAnswers),
        totalMarks,
        maxMarks,
        maxMarks > 0 ? Math.round((totalMarks / maxMarks) * 100) : 0,
        finalSubmissionType,
        tabSwitchCount || 0,
        fullscreenExitCount || 0,
        student.exam_start_time,
        now,
        timeTaken,
      ]
    );

    await query('update mcq_students set has_attempted = true, updated_at = now() where id = $1', [student.id]);
    res.json({ success: true, message: 'Exam submitted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
