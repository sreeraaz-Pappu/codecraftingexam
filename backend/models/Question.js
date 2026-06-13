const mongoose = require('mongoose');

const testCaseSchema = new mongoose.Schema({
  input: { type: String, required: true },
  expectedOutput: { type: String, required: true },
  marks: { type: Number, required: true, min: 1 },
  isHidden: { type: Boolean, default: true },
  description: String,
}, { _id: true });

const questionSchema = new mongoose.Schema({
  order: { type: Number, required: true, unique: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, maxlength: 5000 },
  inputFormat: { type: String, required: true, maxlength: 1000 },
  outputFormat: { type: String, required: true, maxlength: 1000 },
  constraints: { type: String, required: true, maxlength: 1000 },
  sampleInput: { type: String, maxlength: 500 },
  sampleOutput: { type: String, maxlength: 500 },
  testCases: [testCaseSchema],
  totalMarks: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

questionSchema.pre('save', function(next) {
  this.totalMarks = this.testCases.reduce((sum, tc) => sum + tc.marks, 0);
  next();
});

// Never expose test cases to students
questionSchema.methods.toStudentView = function() {
  return {
    _id: this._id,
    order: this.order,
    title: this.title,
    description: this.description,
    inputFormat: this.inputFormat,
    outputFormat: this.outputFormat,
    constraints: this.constraints,
    sampleInput: this.sampleInput,
    sampleOutput: this.sampleOutput,
    totalMarks: this.totalMarks,
    testCaseCount: this.testCases.length,
  };
};

module.exports = mongoose.model('Question', questionSchema);
