const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ── List tickets (admin) ──────────────────────────────────────────────────────

async function listTickets({ status, search, page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const params = [];
  let where = 'WHERE 1=1';
  let idx = 1;

  if (status) {
    where += ` AND t.status = $${idx}`;
    params.push(status);
    idx++;
  }
  if (search) {
    where += ` AND (t.subject ILIKE $${idx} OR COALESCE(cu.full_name, u.phone) ILIKE $${idx} OR t.id::text ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  const countRes = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE t.status = 'OPEN')::int AS open_count,
       COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS')::int AS in_progress_count,
       COUNT(*) FILTER (WHERE t.status = 'RESOLVED')::int AS resolved_count
     FROM support_tickets t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     ${where}`,
    params,
  );
  const agg = countRes.rows[0];

  const { rows } = await pool.query(
    `SELECT
       t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
       COALESCE(cu.full_name, u.phone) AS customer_name,
       u.phone AS customer_phone,
       COUNT(m.id)::int AS message_count
     FROM support_tickets t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     LEFT JOIN support_messages m ON m.ticket_id = t.id
     ${where}
     GROUP BY t.id, cu.full_name, u.phone
     ORDER BY
       CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
       t.updated_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return {
    tickets: rows.map((r) => ({
      id:            r.id,
      subject:       r.subject,
      status:        r.status,
      priority:      r.priority,
      customerName:  r.customer_name ?? 'Unknown',
      customerPhone: r.customer_phone ?? '',
      messageCount:  r.message_count,
      createdAt:     r.created_at,
      updatedAt:     r.updated_at,
    })),
    total:       parseInt(agg.total),
    open:        parseInt(agg.open_count),
    inProgress:  parseInt(agg.in_progress_count),
    resolved:    parseInt(agg.resolved_count),
    totalPages:  Math.max(1, Math.ceil(parseInt(agg.total) / limit)),
    page,
  };
}

// ── Get single ticket with messages ──────────────────────────────────────────

async function getTicket(id) {
  const { rows } = await pool.query(
    `SELECT
       t.*,
       COALESCE(cu.full_name, u.phone) AS customer_name,
       u.phone AS customer_phone,
       u.email AS customer_email
     FROM support_tickets t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     WHERE t.id = $1`,
    [id],
  );
  if (rows.length === 0) throw new AppError('Ticket not found', 404, 'NOT_FOUND');

  const { rows: messages } = await pool.query(
    `SELECT m.id, m.body, m.is_staff, m.sent_at,
            COALESCE(cu.full_name, u.phone, 'Admin') AS sender_name
     FROM support_messages m
     LEFT JOIN users u ON u.id = m.sender_id
     LEFT JOIN customer_user cu ON cu.user_id = m.sender_id
     WHERE m.ticket_id = $1
     ORDER BY m.sent_at ASC`,
    [id],
  );

  const t = rows[0];
  return {
    id:            t.id,
    subject:       t.subject,
    status:        t.status,
    priority:      t.priority,
    customerName:  t.customer_name ?? 'Unknown',
    customerPhone: t.customer_phone ?? '',
    customerEmail: t.customer_email ?? '',
    createdAt:     t.created_at,
    updatedAt:     t.updated_at,
    messages:      messages.map((m) => ({
      id:         m.id,
      body:       m.body,
      isStaff:    m.is_staff,
      senderName: m.sender_name,
      sentAt:     m.sent_at,
    })),
  };
}

// ── Add reply ─────────────────────────────────────────────────────────────────

async function addReply(ticketId, { senderId, body, isStaff = true }) {
  const { rows } = await pool.query(
    `INSERT INTO support_messages (ticket_id, sender_id, body, is_staff)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [ticketId, senderId, body, isStaff],
  );
  // Update ticket timestamp + set to IN_PROGRESS if still OPEN
  await pool.query(
    `UPDATE support_tickets
     SET updated_at = NOW(),
         status = CASE WHEN status = 'OPEN' AND $1 = true THEN 'IN_PROGRESS' ELSE status END
     WHERE id = $2`,
    [isStaff, ticketId],
  );
  return rows[0];
}

// ── Update status ─────────────────────────────────────────────────────────────

async function updateStatus(ticketId, status) {
  const valid = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  if (!valid.includes(status)) throw new AppError('Invalid status', 400, 'INVALID_STATUS');
  const { rowCount } = await pool.query(
    `UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, ticketId],
  );
  if (rowCount === 0) throw new AppError('Ticket not found', 404, 'NOT_FOUND');
}

module.exports = { listTickets, getTicket, addReply, updateStatus };
