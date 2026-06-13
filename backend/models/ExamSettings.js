const mongoose = require('mongoose');

const SUPPORTED_LANGUAGES = ['python', 'java', 'c', 'cpp'];

const examSettingsSchema = new mongoose.Schema({
  singleton: { type: String, default: 'settings', unique: true },
  durationMinutes: { type: Number, default: 60, min: 1, max: 480 },
  startTime: Date,
  endTime: Date,
  isActive: { type: Boolean, default: false },
  allowedLanguages: { type: [String], default: ['python', 'java', 'c', 'cpp'] },
  maxViolationsBeforeSubmit: { type: Number, default: 2 },
  executionTimeoutMs: { type: Number, default: 5000 },
}, { timestamps: true });

module.exports = mongoose.model('ExamSettings', examSettingsSchema);
