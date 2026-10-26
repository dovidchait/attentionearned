import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import pageRoutes from './routes/pages.js';
import { requireAuth } from './lib/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();
app.set('trust proxy', true);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(join(__dirname, 'public')));

// Unauthenticated: auth routes + static assets above
app.use('/auth', authRoutes);

// Protected: apply requireAuth before API and page routes
app.use('/api', requireAuth, apiRoutes);
app.use('/', requireAuth, pageRoutes);

// 404
app.use((req, res) => res.status(404).send('<h1>404 Not found</h1>'));

// Error handler
app.use((err, req, res, _next) => {
  console.error('💥', err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  res.status(err.status || 500).send(`<h1>${err.status || 500} Error</h1><p>${err.message}</p>`);
});

process.on('uncaughtException', err => console.error('💥 Uncaught:', err));
process.on('unhandledRejection', reason => console.error('💥 Rejection:', reason));

// Only bind a port when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`📊 Client dashboard on http://localhost:${PORT}`);
  });
}

export default app;
