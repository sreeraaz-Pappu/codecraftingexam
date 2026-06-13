const mongoose = require('mongoose');

const mcqStudentSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'McqExam', required: true },
  rollNumber: { type: String, required: true, trim: true, uppercase: true },
  fullName: { type: String, required: true, trim: true },
  hasAttempted: { type: Boolean, default: false },
  loginTime: { type: Date, default: null },
  examStartTime: { type: Date, default: null },
}, { timestamps: true });

mcqStudentSchema.index({ examId: 1, rollNumber: 1 }, { unique: true });

module.exports = mongoose.model('McqStudent', mcqStudentSchema);
