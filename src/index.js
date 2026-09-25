import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import subtaskRoutes from './routes/subtasks.js';
import commentRoutes from './routes/comments.js';
import teamRoutes from './routes/team.js';
import eventRoutes from './routes/events.js';
import uploadRoutes from './routes/upload.js';
import activityRoutes from './routes/activity.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';
import goalRoutes from './routes/goals.js';
import { sseHandler } from './sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_FILE = fileURLToPath(new URL('../public/index.html', import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.set('trust proxy', 1);

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: corsOrigin !== '*',
}));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
  permissionsPolicy: false,
}));

app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

let dbReady = null;

function dbReason(err) {
  if (err && err.code) return err.code;
  if (err && err.name) return err.name;
  return 'db_error';
}

function ensureDb() {
  if (!dbReady) {
    dbReady = (async function () {
      if (!process.env.DATABASE_URL) {
        var missing = new Error('DATABASE_URL is not set.');
        missing.code = 'DB_NOT_CONFIGURED';
        throw missing;
      }
      const { default: db } = await import('./db/index.js');
      const run = async function () {
        const { rows } = await db.query("SELECT to_regclass('public.users') AS table_name");
        if (rows[0] && rows[0].table_name) return;
        await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        const fs = await import('fs');
        const schema = fs.readFileSync(new URL('./db/schema.sql', import.meta.url), 'utf-8');
        await db.query(schema);
      };
      try {
        await run();
      } catch (first) {
        await new Promise(function (r) { setTimeout(r, 700); });
        await run();
      }
    })().catch(function (err) {
      dbReady = null;
      throw err;
    });
  }
  return dbReady;
}

app.use('/api', function (req, res, next) {
  ensureDb().then(function () {
    next();
  }).catch(function (err) {
    console.error('Database unavailable [' + dbReason(err) + ']:', err.message);
    res.status(503).json({ error: 'Database not connected.', reason: dbReason(err) });
  });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again in 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api', apiLimiter);
app.use('/api/user', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/subtasks', subtaskRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/team', teamRoutes);
app.get('/api/events/subscribe', sseHandler);
app.use('/api/events', eventRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/goals', goalRoutes);

app.use(express.static(PUBLIC_DIR, {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.get('/health', async (_req, res) => {
  var env = {
    database: !!process.env.DATABASE_URL,
    jwt: !!process.env.JWT_SECRET,
    cors: !!process.env.CORS_ORIGIN,
  };
  if (!process.env.DATABASE_URL) {
    return res.json({ status: 'ok', db: 'not_configured', reason: 'DB_NOT_CONFIGURED', env: env });
  }
  try {
    const { default: db } = await import('./db/index.js');
    await Promise.race([
      db.query('SELECT 1'),
      new Promise(function (_resolve, reject) {
        setTimeout(function () {
          var timeout = new Error('Database check timed out.');
          timeout.code = 'ETIMEDOUT';
          reject(timeout);
        }, 2500);
      }),
    ]);
    res.json({ status: 'ok', db: 'up', env: env });
  } catch (err) {
    console.error('Health DB check failed [' + dbReason(err) + ']:', err.message);
    res.json({ status: 'ok', db: 'down', reason: dbReason(err), env: env });
  }
});

app.get('/_debug', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && req.query.token !== process.env.DEBUG_TOKEN) {
    return res.status(404).json({ error: 'Not found' });
  }
  var info = {
    nodeEnv: process.env.NODE_ENV,
    hasDbUrl: !!process.env.DATABASE_URL,
    dbUrlPrefix: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + '...' : 'NOT SET',
    port: process.env.PORT,
    corsOrigin: process.env.CORS_ORIGIN,
    hasJwtSecret: !!process.env.JWT_SECRET,
  };
  try {
    var db = (await import('./db/index.js')).default;
    var { rows } = await db.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position");
    info.columns = rows;
  } catch (err) {
    info.dbError = err.message;
    info.dbStack = (err.stack || '').split('\n').slice(0, 5).join('\n');
  }
  res.json(info);
});

app.get('*', function (req, res, next) {
  if (path.extname(req.path)) return next();
  res.sendFile(INDEX_FILE, function (err) {
    if (!err) return;
    const qs = req.originalUrl.indexOf('?');
    if (req.accepts('html')) {
      res.redirect(302, qs === -1 ? '/' : '/' + req.originalUrl.slice(qs));
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  console.error('ERROR:', err?.stack || err?.message || err);
  res.status(500).json({ error: 'Internal server error.' });
});

function startRecurrenceEngine() {
  setInterval(async function () {
    try {
      const { default: db } = await import('./db/index.js');
      const today = new Date().toISOString().slice(0, 10);
      const { rows } = await db.query(
        `SELECT id, user_id, name, project_id, assignee_id, description, priority, recurrence, due_date, tags
         FROM tasks WHERE recurrence != 'none' AND due_date IS NOT NULL AND due_date < $1 AND status != 'done'`,
        [today]
      );
      for (const task of rows) {
        var nextDate = new Date(task.due_date);
        if (task.recurrence === 'daily') nextDate.setDate(nextDate.getDate() + 1);
        else if (task.recurrence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
        else if (task.recurrence === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
        var nextDateStr = nextDate.toISOString().slice(0, 10);
        if (nextDateStr <= today) continue;
        var { v4: uid } = await import('uuid');
        await db.query(
          `INSERT INTO tasks (id, user_id, project_id, name, description, status, priority, due_date, assignee_id, recurrence, tags)
           VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7, $8, $9, $10)`,
          [uid(), task.user_id, task.project_id, task.name, task.description, task.priority, nextDateStr, task.assignee_id, task.recurrence, task.tags || '']
        );
      }
    } catch (err) {
      console.error('Recurrence engine error:', err.message);
    }
  }, 3600000);
  console.log('Recurrence engine started (hourly check)');
}

async function start() {
  try {
    await ensureDb();
    console.log('Database connected.');
  } catch (err) {
    console.error('Database connection failed:', err.message);
    console.error('Set DATABASE_URL to a reachable PostgreSQL instance.');
  }

  startRecurrenceEngine();

  app.listen(PORT, function () {
    console.log('Server running on http://localhost:' + PORT);
    console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
  });
}

if (!process.env.VERCEL) {
  start();
}

export default app;
