const mongoose = require('mongoose');

const violationSchema = new mongoose.Schema({
  type: { type: String, enum: ['fullscreen_exit', 'tab_switch', 'right_click', 'keyboard_shortcut', 'copy_paste', 'other'] },
  count: { type: Number, default: 1 },
  timestamps: [Date],
  details: String,
});

const studentSchema = new mongoose.Schema({
  rollNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: 20,
    match: /^[A-Z0-9\-_]+$/,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    match: /^[a-zA-Z\s.'-]+$/,
  },
  ipAddress: String,
  loginTime: Date,
  examStartTime: Date,
  examSubmittedAt: Date,
  hasAttempted: { type: Boolean, default: false },
  isLoggedIn: { type: Boolean, default: false },
  sessionId: String,
  status: {
    type: String,
    enum: ['registered', 'in_exam', 'submitted', 'auto_submitted'],
    default: 'registered',
  },
  violations: [violationSchema],
  totalViolations: { type: Number, default: 0 },
  autoSubmitted: { type: Boolean, default: false },
  autoSubmitReason: String,
}, { timestamps: true });

studentSchema.methods.addViolation = function(type, details) {
  const existing = this.violations.find(v => v.type === type);
  if (existing) {
    existing.count += 1;
    existing.timestamps.push(new Date());
    existing.details = details;
  } else {
    this.violations.push({ type, count: 1, timestamps: [new Date()], details });
  }
  this.totalViolations += 1;
};

module.exports = mongoose.model('Student', studentSchema);
