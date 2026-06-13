require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const xssClean = require('xss-clean');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initSchema, query } = require('./db/postgres');
const { getToolchainStatus } = require('./utils/codeExecutor');
const { requireAdminAuth } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);

const databaseProvider = process.env.DATABASE_PROVIDER || 'supabase';

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  frameguard: { action: 'deny' },
}));

app.use(mongoSanitize());
app.use(xssClean());
app.use(compression());

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 500 : 20,
  message: { error: 'Too many attempts. Please try again shortly.' },
});
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 100 });
app.use('/api/auth', authLimiter);
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// ─── Session ──────────────────────────────────────────────────────────────────
const sessionOptions = {
  name: process.env.SESSION_NAME || 'exam_session',
  secret: process.env.SESSION_SECRET || 'fallback_secret_change_in_prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 4 * 60 * 60 * 1000, // 4 hours
  },
};

if (databaseProvider === 'mongodb') {
  sessionOptions.store = MongoStore.create({ mongoUrl: process.env.MONGODB_URI });
}

app.use(session(sessionOptions));

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend'), {
  dotfiles: 'deny',
  index: false,
  redirect: false,
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  dotfiles: 'deny',
  index: false,
}));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/exam', require('./routes/exam'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/mcq-student', require('./routes/mcqAuth'));
app.use('/api/mcq-exam', require('./routes/mcqExam'));
app.use('/api/mcq-admin', require('./routes/mcqAdmin'));

app.get('/api/health', requireAdminAuth, async (req, res) => {
  const status = {
    ok: true,
    database: { provider: databaseProvider, connected: false },
    server: { port: PORT, nodeEnv: process.env.NODE_ENV || 'development' },
    toolchains: getToolchainStatus(),
    exams: {},
  };
  try {
    await query('select 1');
    status.database.connected = true;
    const coding = (await query('select is_active, duration_minutes, allowed_languages from coding_settings where id = $1', ['settings'])).rows[0];
    const mcq = (await query('select count(*)::int total, count(*) filter (where is_active = true)::int active from mcq_exams')).rows[0];
    status.exams.coding = coding || null;
    status.exams.mcq = mcq || { total: 0, active: 0 };
  } catch (err) {
    status.ok = false;
    status.database.error = err.message;
  }
  res.status(status.ok ? 200 : 500).json(status);
});

// ─── Frontend Routes ──────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/student/login.html')));
app.get('/exam', (req, res) => res.sendFile(path.join(__dirname, '../frontend/student/exam.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/dashboard.html')));
app.get('/admin/questions', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/questions.html')));
app.get('/admin/mcq-questions', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/mcq-questions.html')));
app.get('/admin/results', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/results.html')));
app.get('/admin/mcq-results', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/mcq-results.html')));
app.get('/admin/monitor', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/monitor.html')));
app.get('/admin/health', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/health.html')));
app.get('/mcq-admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/login.html')));
app.get('/mcq-admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/dashboard.html')));
app.get('/mcq-admin/questions', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/mcq-questions.html')));
app.get('/mcq-admin/results', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/mcq-results.html')));
app.get('/mcq-admin/health', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin/health.html')));
app.get('/mcq-exam/:examCode', (req, res) => res.redirect(`/mcq-exam/${req.params.examCode}/login`));
app.get('/mcq-exam/:examCode/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/mcq-student/login.html')));
app.get('/mcq-exam/:examCode/instructions', (req, res) => res.sendFile(path.join(__dirname, '../frontend/mcq-student/instructions.html')));
app.get('/mcq-exam/:examCode/exam', (req, res) => res.sendFile(path.join(__dirname, '../frontend/mcq-student/exam.html')));
app.get('/mcq-exam/:examCode/login.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/mcq-student/login.html')));
app.get('/mcq-exam/:examCode/instructions.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/mcq-student/instructions.html')));
app.get('/mcq-exam/:examCode/exam.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/mcq-student/exam.html')));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON request body' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function connectDatabase() {
  if (databaseProvider === 'supabase') {
    if (!process.env.SUPABASE_DATABASE_URL) {
      throw new Error('SUPABASE_DATABASE_URL is required for Supabase mode.');
    }
    await initSchema();
    console.log('Supabase Postgres connected and schema ready');
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required for MongoDB mode.');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('MongoDB connected');
}

// Start
const PORT = process.env.PORT || 8080;
connectDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Database startup failed:', err.message);
    process.exit(1);
  });

module.exports = app;
