const mongoose = require('mongoose');

const testResultSchema = new mongoose.Schema({
  testCaseId: mongoose.Schema.Types.ObjectId,
  passed: Boolean,
  marks: Number,
  executionTime: Number,
  error: String,
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  code: { type: String, required: true, maxlength: 50000 },
  language: { type: String, default: 'python', enum: ['python', 'java', 'c', 'cpp'] },
  testResults: [testResultSchema],
  testCasesPassed: { type: Number, default: 0 },
  totalTestCases: { type: Number, default: 0 },
  score: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
  submittedAt: { type: Date, default: Date.now },
  executionStatus: {
    type: String,
    enum: ['pending', 'running', 'completed', 'timeout', 'error'],
    default: 'pending',
  },
  errorMessage: String,
}, { timestamps: true });

module.exports = mongoose.model('Submission', submissionSchema);
