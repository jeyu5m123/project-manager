import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import db from '../db/index.js';
import nodemailer from 'nodemailer';
import email from '../email.js';

var router = Router();

var smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().min(1),
  pass: z.string().min(1),
  fromName: z.string().optional().default('Project Manager'),
  fromAddr: z.string().optional(),
});

router.get('/smtp', requireAuth, async function (_req, res) {
  try {
    var { rows } = await db.query('SELECT value FROM settings WHERE key = $1 LIMIT 1', ['smtp']);
    if (rows.length === 0) {
      return res.json({ configured: false });
    }
    var config = rows[0].value || {};
    res.json({ configured: true, host: config.host, port: config.port, secure: config.secure, user: config.user, fromName: config.fromName, fromAddr: config.fromAddr });
  } catch (err) {
    console.error('Failed to get SMTP config:', err.message);
    res.status(500).json({ error: 'Failed to load SMTP config.' });
  }
});

router.put('/smtp', requireAuth, validate(smtpSchema), async function (req, res) {
  try {
    var { host, port, secure, user, pass, fromName, fromAddr } = req.validatedBody;
    var value = { host, port, secure, user, pass, fromName, fromAddr: fromAddr || user };
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      ['smtp', value]
    );
    email.refreshTransport();
    res.json({ message: 'SMTP settings saved.' });
  } catch (err) {
    console.error('Failed to save SMTP config:', err.message);
    res.status(500).json({ error: 'Failed to save SMTP config.' });
  }
});

router.post('/smtp/test', requireAuth, validate(smtpSchema), async function (req, res) {
  try {
    var { host, port, secure, user, pass, fromName, fromAddr } = req.validatedBody;
    var transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: secure,
      auth: { user: user, pass: pass },
    });
    await transporter.verify();
    var info = await transporter.sendMail({
      from: '"' + (fromName || 'Project Manager') + '" <' + (fromAddr || user) + '>',
      to: user,
      subject: 'SMTP Test — Project Manager',
      html: '<p>Your SMTP settings work correctly.</p>',
    });
    res.json({ message: 'SMTP test email sent. Check your inbox.', messageId: info.messageId });
  } catch (err) {
    console.error('SMTP test failed:', err.message);
    res.status(400).json({ error: 'SMTP test failed: ' + err.message });
  }
});

var webhookSchema = z.object({ webhook_url: z.string().max(500).optional() });

router.get('/webhook', requireAuth, async function (req, res) {
  try {
    var { rows } = await db.query("SELECT value FROM settings WHERE key = 'webhook' LIMIT 1");
    var cfg = rows.length ? rows[0].value : null;
    res.json({ webhook_url: cfg && cfg.webhook_url ? cfg.webhook_url : '' });
  } catch (err) { res.status(500).json({ error: 'Failed.' }); }
});

router.put('/webhook', requireAuth, validate(webhookSchema), async function (req, res) {
  try {
    var value = { webhook_url: req.validatedBody.webhook_url || '' };
    await db.query("INSERT INTO settings (key, value, updated_at) VALUES ('webhook', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()", [value]);
    res.json({ message: 'Webhook URL saved.' });
  } catch (err) { res.status(500).json({ error: 'Failed.' }); }
});

export default router;
