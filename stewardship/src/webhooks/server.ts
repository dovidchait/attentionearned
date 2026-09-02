import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { handleZernioEvent, handleEmailItEvent, WebhookAuthError } from './handlers.js';

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const rawBody = await readBody(req);
  const signature = (req.headers['x-hub-signature-256'] ?? req.headers['x-signature'] ?? '') as string;

  try {
    if (req.url === '/webhooks/zernio') {
      await handleZernioEvent(rawBody, signature);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/webhooks/emailit') {
      await handleEmailItEvent(rawBody, signature);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (err) {
    if (err instanceof WebhookAuthError) {
      logger.warn({ url: req.url, err: (err as Error).message }, 'Webhook auth failure');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    logger.error({ url: req.url, err }, 'Webhook handler error');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}

export function createWebhookServer(port?: number): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: Error) => {
      logger.error({ err }, 'Unhandled webhook server error');
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  });

  const listenPort = port ?? parseInt(env.WEBHOOK_PORT, 10);
  server.listen(listenPort, () => {
    logger.info({ port: listenPort }, 'Webhook server listening');
  });

  return server;
}
