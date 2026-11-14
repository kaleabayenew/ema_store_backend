const nodemailer = require('nodemailer');

// Sends email via SMTP. Configure with env vars:
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
// If SMTP is not configured the email is logged and the call resolves —
// callers never break because email delivery isn't available.
function getTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[mailer] SMTP not configured — skipped email to ${to}: ${subject}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@emastore.et',
      to,
      subject,
      html,
      text,
    });
    return { sent: true };
  } catch (err) {
    console.error(`[mailer] failed to send email to ${to}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail };
