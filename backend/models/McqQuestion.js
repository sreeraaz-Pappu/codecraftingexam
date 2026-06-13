const mongoose = require('mongoose');

const mcqQuestionSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'McqExam', required: true },
  questionText: { type: String, required: true, trim: true },
  questionType: { type: String, enum: ['mcq', 'fill'], required: true },
  options: { type: [String], default: [] },
  correctAnswer: { type: String, required: true },
  marks: { type: Number, default: 1 },
  order: { type: Number, default: 0 },
  questionImage: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('McqQuestion', mcqQuestionSchema);
