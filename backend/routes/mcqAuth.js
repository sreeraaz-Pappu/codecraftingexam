const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { query } = require('../db/postgres');

router.post('/:examCode/login', async (req, res) => {
  try {
    const { examCode } = req.params;
    const { rollNumber, fullName } = req.body;

    if (!rollNumber || !fullName) {
      return res.status(400).json({ success: false, message: 'Roll number and full name are required.' });
    }

    const examResult = await query('select * from mcq_exams where exam_code = $1', [examCode.toLowerCase()]);
    const exam = examResult.rows[0];
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found. Check your URL.' });
    if (!exam.is_active) {
      return res.status(403).json({ success: false, message: 'This exam is not currently active.' });
    }

    const roll = rollNumber.trim().toUpperCase();
    const name = fullName.trim();
    const studentResult = await query(
      'select * from mcq_students where exam_id = $1 and roll_number = $2',
      [exam.id, roll]
    );
    let student = studentResult.rows[0];

    if (student) {
      if (student.has_attempted) {
        return res.status(403).json({ success: false, message: 'You have already attempted this exam.' });
      }
      student = (await query(
        'update mcq_students set full_name = $1, login_time = now(), updated_at = now() where id = $2 returning *',
        [name, student.id]
      )).rows[0];
    } else {
      student = (await query(
        'insert into mcq_students (exam_id, roll_number, full_name, login_time) values ($1,$2,$3,now()) returning *',
        [exam.id, roll, name]
      )).rows[0];
    }

    const token = jwt.sign(
      { studentId: student.id, rollNumber: roll, fullName: name, examId: exam.id, examCode },
      process.env.JWT_SECRET || process.env.SESSION_SECRET || 'change_this_mcq_secret',
      { expiresIn: '4h' }
    );

    res.json({
      success: true,
      token,
      student: { rollNumber: roll, fullName: name },
      examSettings: {
        examTitle: exam.exam_title,
        duration: exam.duration,
        instructions: exam.instructions,
        examCode,
      },
    });
  } catch (err) {
    console.error('MCQ login error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

module.exports = router;
