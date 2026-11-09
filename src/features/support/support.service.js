const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ── Create ticket (customer) ───────────────────────────────────────────────────

async function createTicket({ userId, guestId, subject, initialMessage, priority = 'MEDIUM' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query(
      `INSERT INTO support_tickets (user_id, guest_id, subject, status, priority)
       VALUES ($1, $2, $3, 'OPEN', $4)
       RETURNING *`,
      [userId || null, guestId || null, subject, priority],
    );
    const ticket = ticketRes.rows[0];

    const messageRes = await client.query(
      `INSERT INTO support_messages (ticket_id, sender_id, guest_id, body, is_staff)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [ticket.id, userId || null, guestId || null, initialMessage],
    );

    await client.query('COMMIT');
    return {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      initialMessage: messageRes.rows[0],
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Get customer tickets ──────────────────────────────────────────────────────

async function getCustomerTickets(userId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
            (SELECT body    FROM support_messages WHERE ticket_id = t.id ORDER BY sent_at DESC LIMIT 1) AS last_message,
            (SELECT sent_at FROM support_messages WHERE ticket_id = t.id ORDER BY sent_at DESC LIMIT 1) AS last_message_at
     FROM support_tickets t
     WHERE t.user_id = $1
     ORDER BY t.updated_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id, subject: r.subject, status: r.status, priority: r.priority,
    createdAt: r.created_at, updatedAt: r.updated_at,
    lastMessage: r.last_message, lastMessageAt: r.last_message_at,
  }));
}

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
       COUNT(*)::int                                                  AS total,
       COUNT(*) FILTER (WHERE t.status = 'OPEN')::int                AS open_count,
       COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS')::int         AS in_progress_count,
       COUNT(*) FILTER (WHERE t.status = 'RESOLVED')::int            AS resolved_count
     FROM support_tickets t
     LEFT JOIN users u         ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     ${where}`,
    params,
  );
  const agg = countRes.rows[0];

  const { rows } = await pool.query(
    `SELECT
       t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
       COALESCE(cu.full_name, u.phone) AS customer_name,
       u.phone                         AS customer_phone,
       COUNT(m.id)::int                AS message_count,
       COUNT(m.id) FILTER (WHERE m.is_staff = true AND m.read_at IS NULL)::int AS unread_count
     FROM support_tickets t
     LEFT JOIN users u              ON u.id = t.user_id
     LEFT JOIN customer_user cu     ON cu.user_id = t.user_id
     LEFT JOIN support_messages m   ON m.ticket_id = t.id
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
      customerName:  r.customer_name ?? 'Guest',
      customerPhone: r.customer_phone ?? '',
      messageCount:  r.message_count,
      unreadCount:   r.unread_count,
      createdAt:     r.created_at,
      updatedAt:     r.updated_at,
    })),
    total:      parseInt(agg.total),
    open:       parseInt(agg.open_count),
    inProgress: parseInt(agg.in_progress_count),
    resolved:   parseInt(agg.resolved_count),
    totalPages: Math.max(1, Math.ceil(parseInt(agg.total) / limit)),
    page,
  };
}

// ── Get single ticket with messages ──────────────────────────────────────────

async function getTicket(id) {
  const { rows } = await pool.query(
    `SELECT
       t.*,
       COALESCE(cu.full_name, u.phone, t.guest_id) AS customer_name,
       u.phone                         AS customer_phone,
       u.email                         AS customer_email
     FROM support_tickets t
     LEFT JOIN users u         ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     WHERE t.id = $1`,
    [id],
  );
  if (rows.length === 0) throw new AppError('Ticket not found', 404, 'NOT_FOUND');

  const { rows: messages } = await pool.query(
    `SELECT m.id, m.body, m.is_staff, m.sent_at, m.read_at, m.guest_id,
            CASE
              WHEN m.is_staff = true THEN COALESCE(cu.full_name, u.phone, 'Admin')
              ELSE COALESCE(cu.full_name, u.phone, m.guest_id, 'Customer')
            END AS sender_name
     FROM support_messages m
     LEFT JOIN users u         ON u.id = m.sender_id
     LEFT JOIN customer_user cu ON cu.user_id = m.sender_id
     WHERE m.ticket_id = $1
     ORDER BY m.sent_at ASC`,
    [id],
  );

  console.log('📨 Messages for ticket', id, ':', messages.map(m => ({ id: m.id, is_staff: m.is_staff, sender_name: m.sender_name, guest_id: m.guest_id })));

  const t = rows[0];
  return {
    id:            t.id,
    subject:       t.subject,
    status:        t.status,
    priority:      t.priority,
    customerName:  t.customer_name ?? 'Guest',
    customerPhone: t.customer_phone ?? '',
    customerEmail: t.customer_email ?? '',
    createdAt:     t.created_at,
    updatedAt:     t.updated_at,
    messages: messages.map((m) => ({
      id:         m.id,
      body:       m.body,
      isStaff:    m.is_staff === true,
      senderName: m.sender_name,
      sentAt:     m.sent_at,
      readAt:     m.read_at,
    })),
  };
}

// ── Add reply ─────────────────────────────────────────────────────────────────

async function addReply(ticketId, { senderId, guestId, body, isStaff = true }) {
  const { rows } = await pool.query(
    `INSERT INTO support_messages (ticket_id, sender_id, guest_id, body, is_staff)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [ticketId, senderId || null, guestId || null, body, isStaff],
  );
  await pool.query(
    `UPDATE support_tickets
     SET updated_at = NOW(),
         status = CASE
           WHEN $1 = true  AND status = 'OPEN' THEN 'IN_PROGRESS'
           WHEN $1 = false THEN 'OPEN'
           ELSE status
         END
     WHERE id = $2`,
    [isStaff, ticketId],
  );
  // Mark customer messages as unread when staff replies (for customer to see new message)
  if (isStaff) {
    await pool.query(
      `UPDATE support_messages
       SET read_at = NULL
       WHERE ticket_id = $1 AND is_staff = false`,
      [ticketId],
    );
  } else {
    // Mark staff messages as read when customer replies (for staff to see)
    await pool.query(
      `UPDATE support_messages
       SET read_at = NOW()
       WHERE ticket_id = $1 AND is_staff = true`,
      [ticketId],
    );
  }
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

// ── Support settings ─────────────────────────────────────────────────────────

async function getSupportSettings() {
  const { rows } = await pool.query(`SELECT * FROM support_settings WHERE id = 'default'`);
  const r = rows[0] || {};
  return {
    welcomeMessage:    r.welcome_message     || 'Hello! How can we help you today?',
    isAutoReplyEnabled: r.is_auto_reply_enabled ?? true,
    quickStarters:     r.quick_starters      || [],
  };
}

async function updateSupportSettings({ welcomeMessage, isAutoReplyEnabled, quickStarters }) {
  const { rows } = await pool.query(
    `UPDATE support_settings
     SET welcome_message        = COALESCE($1, welcome_message),
         is_auto_reply_enabled  = COALESCE($2, is_auto_reply_enabled),
         quick_starters         = COALESCE($3::jsonb, quick_starters),
         updated_at             = NOW()
     WHERE id = 'default'
     RETURNING *`,
    [welcomeMessage, isAutoReplyEnabled, quickStarters ? JSON.stringify(quickStarters) : null],
  );
  return rows[0];
}

// ── Default messages ──────────────────────────────────────────────────────────

async function listDefaultMessages() {
  const { rows } = await pool.query(
    `SELECT id, title, body, sort_order, created_at, updated_at
     FROM support_default_messages
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows.map((r) => ({
    id:        r.id,
    title:     r.title,
    body:      r.body,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function createDefaultMessage({ title, body, sortOrder = 0 }) {
  const { rows } = await pool.query(
    `INSERT INTO support_default_messages (title, body, sort_order)
     VALUES ($1, $2, $3) RETURNING *`,
    [title, body, sortOrder],
  );
  const r = rows[0];
  return { id: r.id, title: r.title, body: r.body, sortOrder: r.sort_order };
}

async function updateDefaultMessage(id, { title, body, sortOrder }) {
  // Only update fields that were actually provided
  const sets = [];
  const params = [];
  let idx = 1;

  if (title !== undefined) { sets.push(`title = $${idx++}`);      params.push(title); }
  if (body  !== undefined) { sets.push(`body = $${idx++}`);       params.push(body); }
  if (sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(sortOrder); }

  if (sets.length === 0) throw new AppError('No fields to update', 400, 'BAD_REQUEST');

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await pool.query(
    `UPDATE support_default_messages SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  if (rows.length === 0) throw new AppError('Default message not found', 404, 'NOT_FOUND');
  const r = rows[0];
  return { id: r.id, title: r.title, body: r.body, sortOrder: r.sort_order };
}

async function deleteDefaultMessage(id) {
  const { rowCount } = await pool.query(
    `DELETE FROM support_default_messages WHERE id = $1`, [id],
  );
  if (rowCount === 0) throw new AppError('Default message not found', 404, 'NOT_FOUND');
}

// (see full exports at the bottom of this file)

// ── Conversation history (Super Admin only) ───────────────────────────────────

async function listConversationHistory({ staffId, status, dateFrom, dateTo, search, page = 1, limit = 20 } = {}) {
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
    where += ` AND (t.subject ILIKE $${idx} OR COALESCE(cu.full_name, u.phone) ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  if (dateFrom) {
    where += ` AND t.created_at >= $${idx}`;
    params.push(new Date(dateFrom));
    idx++;
  }

  if (dateTo) {
    where += ` AND t.created_at <= $${idx}`;
    params.push(new Date(dateTo));
    idx++;
  }

  // Filter: only tickets that have at least one staff reply from the given staff user
  let staffJoin = '';
  if (staffId) {
    staffJoin = `INNER JOIN support_messages sm_filter ON sm_filter.ticket_id = t.id AND sm_filter.is_staff = true AND sm_filter.sender_id = $${idx}`;
    params.push(staffId);
    idx++;
  }

  const countRes = await pool.query(
    `SELECT COUNT(DISTINCT t.id)::int AS total
     FROM support_tickets t
     LEFT JOIN users u          ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     ${staffJoin}
     ${where}`,
    params,
  );
  const total = countRes.rows[0].total;

  const { rows } = await pool.query(
    `SELECT
       t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
       COALESCE(cu.full_name, u.phone)            AS customer_name,
       u.phone                                    AS customer_phone,
       COUNT(DISTINCT m.id)::int                  AS total_messages,
       COUNT(DISTINCT m.id) FILTER (WHERE m.is_staff = true)::int AS staff_messages,
       COUNT(DISTINCT m.id) FILTER (WHERE m.is_staff = false)::int AS customer_messages,
       -- last staff reply info
       (SELECT COALESCE(au.full_name, su.email, su.phone)
        FROM support_messages lm
        LEFT JOIN users su         ON su.id = lm.sender_id
        LEFT JOIN admin_user au    ON au.user_id = lm.sender_id
        WHERE lm.ticket_id = t.id AND lm.is_staff = true
        ORDER BY lm.sent_at DESC LIMIT 1)          AS last_staff_name,
       (SELECT sent_at FROM support_messages lm
        WHERE lm.ticket_id = t.id AND lm.is_staff = true
        ORDER BY lm.sent_at DESC LIMIT 1)          AS last_staff_at
     FROM support_tickets t
     LEFT JOIN users u          ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     LEFT JOIN support_messages m ON m.ticket_id = t.id
     ${staffJoin}
     ${where}
     GROUP BY t.id, cu.full_name, u.phone
     ORDER BY t.updated_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return {
    tickets: rows.map((r) => ({
      id:               r.id,
      subject:          r.subject,
      status:           r.status,
      priority:         r.priority,
      customerName:     r.customer_name ?? 'Unknown',
      customerPhone:    r.customer_phone ?? '',
      totalMessages:    r.total_messages,
      staffMessages:    r.staff_messages,
      customerMessages: r.customer_messages,
      lastStaffName:    r.last_staff_name ?? null,
      lastStaffAt:      r.last_staff_at ?? null,
      createdAt:        r.created_at,
      updatedAt:        r.updated_at,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// ── List staff users (for filter dropdown) ────────────────────────────────────

async function listStaffUsers() {
  const { rows } = await pool.query(
    `SELECT u.id,
            COALESCE(au.full_name, u.email, u.phone) AS name,
            u.role,
            u.email
     FROM users u
     LEFT JOIN admin_user au ON au.user_id = u.id
     WHERE u.role != 'CUSTOMER' AND u.role != 'PARTNER'
     ORDER BY au.full_name ASC NULLS LAST`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, email: r.email }));
}

// ── Read receipts & typing ────────────────────────────────────────────────────

/**
 * Mark messages as read.
 * byStaff=true  → admin has read the customer's messages (is_staff=false)
 * byStaff=false → customer has read the staff's messages (is_staff=true)
 */
async function markMessagesRead(ticketId, { byStaff = true } = {}) {
  const targetIsStaff = !byStaff; // the messages being marked read
  await pool.query(
    `UPDATE support_messages
     SET read_at = NOW()
     WHERE ticket_id = $1 AND is_staff = $2 AND read_at IS NULL`,
    [ticketId, targetIsStaff],
  );
}

/** Record that a user is typing on a ticket. */
async function recordTyping(ticketId, { userId, isStaff }) {
  await pool.query(
    `INSERT INTO support_typing (ticket_id, user_id, is_staff, typed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (ticket_id, user_id)
     DO UPDATE SET typed_at = NOW(), is_staff = $3`,
    [ticketId, userId, isStaff],
  );
}

/** Who is currently typing on this ticket (within the last N seconds)? */
async function getTypingStatus(ticketId, { windowSeconds = 5 } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT is_staff, MAX(typed_at) AS last_typed
       FROM support_typing
       WHERE ticket_id = $1 AND typed_at > NOW() - ($2 || ' seconds')::interval
       GROUP BY is_staff`,
      [ticketId, String(windowSeconds)],
    );
    const staffTyping = rows.some((r) => r.is_staff === true);
    const customerTyping = rows.some((r) => r.is_staff === false);
    return { staffTyping, customerTyping };
  } catch (e) {
    // If table doesn't exist or other error, return not typing
    console.error('getTypingStatus error:', e.message);
    return { staffTyping: false, customerTyping: false };
  }
}

module.exports = {
  listTickets,
  getTicket,
  addReply,
  updateStatus,
  createTicket,
  getCustomerTickets,
  getSupportSettings,
  updateSupportSettings,
  listDefaultMessages,
  createDefaultMessage,
  updateDefaultMessage,
  deleteDefaultMessage,
  listConversationHistory,
  listStaffUsers,
  markMessagesRead,
  recordTyping,
  getTypingStatus,
};
