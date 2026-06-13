const { query } = require('../db/postgres');

const requireStudentAuth = async (req, res, next) => {
  if (!req.session || !req.session.studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await query('select * from coding_students where id = $1', [req.session.studentId]);
    const student = result.rows[0];
    if (!student) return res.status(401).json({ error: 'Session invalid' });
    if (!student.is_logged_in) return res.status(401).json({ error: 'Session expired' });
    if (student.session_id !== req.session.sessionId) {
      return res.status(401).json({ error: 'Multiple sessions detected', code: 'MULTI_SESSION' });
    }
    req.student = {
      _id: student.id,
      id: student.id,
      rollNumber: student.roll_number,
      fullName: student.full_name,
      status: student.status,
      totalViolations: student.total_violations,
      violations: student.violations || [],
      row: student,
    };
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
};

const requireAdminAuth = (req, res, next) => {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { requireStudentAuth, requireAdminAuth };
