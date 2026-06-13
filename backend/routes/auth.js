const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { requireStudentAuth, requireAdminAuth } = require('../middleware/auth');
const { query } = require('../db/postgres');

router.post('/student/login',
  [
    body('rollNumber').trim().isLength({ min: 1, max: 20 }).matches(/^[A-Z0-9a-z\-_]+$/),
    body('fullName').trim().isLength({ min: 2, max: 100 }).matches(/^[a-zA-Z\s.'-]+$/),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid input' });

    const { rollNumber, fullName } = req.body;
    const rollUpper = rollNumber.toUpperCase();
    const cleanName = fullName.trim();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    try {
      const settingsResult = await query('select * from coding_settings where id = $1', ['settings']);
      const settings = settingsResult.rows[0];
      if (!settings || !settings.is_active) {
        return res.status(403).json({ error: 'Exam is not active. Please wait for the exam to begin.' });
      }

      const now = new Date();
      if (settings.start_time && now < settings.start_time) {
        return res.status(403).json({ error: 'Exam has not started yet.' });
      }
      if (settings.end_time && now > settings.end_time) {
        return res.status(403).json({ error: 'Exam time has ended.' });
      }

      const existingResult = await query('select * from coding_students where roll_number = $1', [rollUpper]);
      let student = existingResult.rows[0];

      if (student) {
        if (student.full_name.toLowerCase() !== cleanName.toLowerCase()) {
          return res.status(401).json({ error: 'Name does not match records for this Roll Number.' });
        }
        if (student.has_attempted) {
          return res.status(403).json({ error: 'You have already attempted this exam. Only one attempt is allowed.' });
        }
        if (student.is_logged_in && student.session_id) {
          return res.status(403).json({ error: 'Another session is already active for this Roll Number.' });
        }
      } else {
        const created = await query(
          'insert into coding_students (roll_number, full_name) values ($1, $2) returning *',
          [rollUpper, cleanName]
        );
        student = created.rows[0];
      }

      const sessionId = uuidv4();
      const updated = await query(
        `update coding_students
         set ip_address = $1, login_time = $2, exam_start_time = $2, is_logged_in = true,
             session_id = $3, has_attempted = true, status = 'in_exam', updated_at = now()
         where id = $4
         returning *`,
        [ip, now, sessionId, student.id]
      );
      student = updated.rows[0];

      req.session.studentId = student.id;
      req.session.sessionId = sessionId;
      req.session.examStart = now.getTime();
      req.session.durationMs = (settings.duration_minutes || 60) * 60 * 1000;

      res.json({ success: true, student: { rollNumber: student.roll_number, fullName: student.full_name } });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

router.get('/student/status', requireStudentAuth, (req, res) => {
  const elapsed = Date.now() - req.session.examStart;
  const remaining = Math.max(0, req.session.durationMs - elapsed);
  res.json({
    loggedIn: true,
    rollNumber: req.student.rollNumber,
    fullName: req.student.fullName,
    remainingMs: remaining,
    status: req.student.status,
  });
});

router.post('/admin/login',
  [
    body('username').trim().isLength({ min: 1, max: 50 }),
    body('password').isLength({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid input' });

    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin@SecureExam2024!';

    if (username !== adminUser || password !== adminPass) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.isAdmin = true;
    req.session.adminUsername = username;
    res.json({ success: true });
  }
);

router.post('/admin/logout', requireAdminAuth, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/admin/status', requireAdminAuth, (req, res) => {
  res.json({ loggedIn: true, username: req.session.adminUsername });
});

module.exports = router;
