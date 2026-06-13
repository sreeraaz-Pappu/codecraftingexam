const mongoose = require('mongoose');
const Question = require('../models/Question');
const ExamSettings = require('../models/ExamSettings');
require('dotenv').config();

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    await Question.deleteMany({});
    await ExamSettings.deleteMany({});

    const questions = [
      {
        order: 1,
        title: 'Sum of Two Numbers',
        description: 'Write a program that reads two integers and prints their sum.',
        inputFormat: 'Two integers a and b on separate lines.',
        outputFormat: 'A single integer representing the sum.',
        constraints: '1 ≤ a, b ≤ 10^9',
        sampleInput: '3\n5',
        sampleOutput: '8',
        testCases: [
          { input: '3\n5', expectedOutput: '8', marks: 4 },
          { input: '10\n20', expectedOutput: '30', marks: 4 },
          { input: '100\n200', expectedOutput: '300', marks: 4 },
          { input: '999999999\n1', expectedOutput: '1000000000', marks: 4 },
          { input: '0\n0', expectedOutput: '0', marks: 4 }
        ],
        totalMarks: 20,
        isActive: true
      },
      {
        order: 2,
        title: 'Reverse a String',
        description: 'Write a program that reads a string and prints it reversed.',
        inputFormat: 'A single string on one line.',
        outputFormat: 'The reversed string.',
        constraints: '1 ≤ length ≤ 1000',
        sampleInput: 'hello',
        sampleOutput: 'olleh',
        testCases: [
          { input: 'hello', expectedOutput: 'olleh', marks: 4 },
          { input: 'abcde', expectedOutput: 'edcba', marks: 4 },
          { input: 'racecar', expectedOutput: 'racecar', marks: 4 },
          { input: 'OpenAI', expectedOutput: 'IAnepO', marks: 4 },
          { input: 'a', expectedOutput: 'a', marks: 4 }
        ],
        totalMarks: 20,
        isActive: true
      },
      {
        order: 3,
        title: 'Count Vowels',
        description: 'Write a program that counts the number of vowels (a, e, i, o, u) in a given string.',
        inputFormat: 'A single string on one line.',
        outputFormat: 'A single integer — the number of vowels.',
        constraints: '1 ≤ length ≤ 1000. String contains only lowercase letters.',
        sampleInput: 'hello',
        sampleOutput: '2',
        testCases: [
          { input: 'hello', expectedOutput: '2', marks: 4 },
          { input: 'aeiou', expectedOutput: '5', marks: 4 },
          { input: 'rhythm', expectedOutput: '0', marks: 4 },
          { input: 'programming', expectedOutput: '3', marks: 4 },
          { input: 'a', expectedOutput: '1', marks: 4 }
        ],
        totalMarks: 20,
        isActive: true
      }
    ];

    await Question.insertMany(questions);
    console.log('✅ Sample questions created');

    await ExamSettings.create({
      duration: 60,
      allowedLanguages: ['python', 'java', 'c', 'cpp'],
      isActive: false,
      startTime: null,
      endTime: null
    });
    console.log('✅ Exam settings created');
    console.log('\n🔐 Admin credentials:');
    console.log('   Username:', process.env.ADMIN_USERNAME || 'admin');
    console.log('   Password:', process.env.ADMIN_PASSWORD || 'Admin@1234!');

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  }
};

seedData();
