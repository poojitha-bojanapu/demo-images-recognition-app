import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';

import { env } from './env.js';
import { router } from './routes.js';

function corsOrigin(): cors.CorsOptions['origin'] {
  if (env.ALLOWED_ORIGINS === '*') return true; // reflect any origin (demo default)
  const list = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return (origin, cb) => {
    if (!origin || list.includes(origin)) cb(null, true);
    else cb(null, false);
  };
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigin() }));
  app.use(express.json({ limit: '1mb' }));

  app.use((req, _res, next) => {
    if (env.LOG_LEVEL === 'debug') console.log(`${req.method} ${req.url}`);
    next();
  });

  app.use(router);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const e = err as { name?: string; message?: string; type?: string };
    if (e?.type === 'entity.parse.failed' || e?.name === 'SyntaxError') {
      res.status(400).json({ error: 'invalid JSON body' });
      return;
    }
    console.error('api_error', JSON.stringify({ path: req.originalUrl, name: e?.name, message: e?.message }));
    if (e?.name === 'NoSuchBucket' || e?.name === 'AccessDenied') {
      res.status(503).json({ error: 'backend not configured', detail: e.name });
      return;
    }
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
