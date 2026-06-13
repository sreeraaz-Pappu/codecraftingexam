const mongoose = require('mongoose');

const mcqExamSchema = new mongoose.Schema({
  examCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: /^[a-z0-9-]+$/,
  },
  examTitle: { type: String, required: true, trim: true },
  duration: { type: Number, default: 30 },
  isActive: { type: Boolean, default: false },
  instructions: { type: String, default: 'Read all questions carefully before answering.' },
}, { timestamps: true });

module.exports = mongoose.model('McqExam', mcqExamSchema);
