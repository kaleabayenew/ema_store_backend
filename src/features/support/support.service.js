const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const { getChatImageUrl } = require('../../core/config/storage');

// ── Create ticket (customer) ───────────────────────────────────────────────────

async function createTicket({ userId, guestId, subject, initialMessage, priority = 'MEDIUM' }) {
  if (!userId && !guestId) {
    throw new AppError('guestId is required for guest tickets', 400, 'GUEST_ID_REQUIRED');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // If the user just logged in, attach their old guest tickets to the account
    if (userId && guestId) {
      await client.query(
        `UPDATE support_tickets SET user_id = $1 WHERE guest_id = $2 AND user_id IS NULL`,
        [userId, guestId],
      );
      await client.query(
        `UPDATE support_messages SET sender_id = $1 WHERE guest_id = $2 AND sender_id IS NULL AND is_staff = false`,
        [userId, guestId],
      );
    }

    // Reuse the existing conversation for this person/device instead of making a new one.
    // This is what stops one guest from showing up as many users on the web.
    const existingRes = userId
      ? await client.query(
          `SELECT * FROM support_tickets
           WHERE user_id = $1 AND status <> 'CLOSED'
           ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
          [userId],
        )
      : await client.query(
          `SELECT * FROM support_tickets
           WHERE guest_id = $1 AND user_id IS NULL AND status <> 'CLOSED'
           ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
          [guestId],
        );

    let ticket = existingRes.rows[0];
    const wasReused = !!ticket;
    if (!ticket) {
      const ticketRes = await client.query(
        `INSERT INTO support_tickets (user_id, guest_id, subject, status, priority)
         VALUES ($1, $2, $3, 'OPEN', $4)
         RETURNING *`,
        [userId || null, userId ? null : guestId, subject, priority],
      );
      ticket = ticketRes.rows[0];
    } else if (ticket.status === 'RESOLVED') {
      await client.query(
        `UPDATE support_tickets SET status = 'OPEN', updated_at = NOW() WHERE id = $1`,
        [ticket.id],
      );
      ticket.status = 'OPEN';
    } else {
      await client.query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticket.id]);
    }

    if (ticket && subject && subject.toLowerCase().includes('partner') && !ticket.subject.toLowerCase().includes('partner')) {
      await client.query(`UPDATE support_tickets SET subject = $1 WHERE id = $2`, [subject, ticket.id]);
      ticket.subject = subject;
    }

    const messageRes = await client.query(
      `INSERT INTO support_messages (ticket_id, sender_id, guest_id, body, is_staff)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [ticket.id, userId || null, userId ? null : guestId, initialMessage],
    );

    await client.query('COMMIT');
    return {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      reused: wasReused,
      initialMessage: {
        id: messageRes.rows[0].id,
        body: messageRes.rows[0].body,
        isStaff: false,
        sentAt: messageRes.rows[0].sent_at,
      },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Get customer tickets ──────────────────────────────────────────────────────

/** Attach a guest's tickets/messages to a user account (after login). */
async function claimGuestTickets(userId, guestId) {
  if (!userId || !guestId) return;
  await pool.query(
    `UPDATE support_tickets SET user_id = $1 WHERE guest_id = $2 AND user_id IS NULL`,
    [userId, guestId],
  );
  await pool.query(
    `UPDATE support_messages SET sender_id = $1 WHERE guest_id = $2 AND sender_id IS NULL AND is_staff = false`,
    [userId, guestId],
  );
}

async function getCustomerTickets(userId, guestId) {
  const conds = [];
  const params = [];
  if (userId)  { params.push(userId);  conds.push(`t.user_id = $${params.length}`); }
  if (guestId) { params.push(guestId); conds.push(`t.guest_id = $${params.length}`); }
  if (conds.length === 0) return [];

  const { rows } = await pool.query(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
            (SELECT body    FROM support_messages WHERE ticket_id = t.id ORDER BY sent_at DESC LIMIT 1) AS last_message,
            (SELECT sent_at FROM support_messages WHERE ticket_id = t.id ORDER BY sent_at DESC LIMIT 1) AS last_message_at,
            (SELECT COUNT(*)::int FROM support_messages WHERE ticket_id = t.id AND is_staff = true AND read_at IS NULL) AS unread_count
     FROM support_tickets t
     WHERE ${conds.join(' OR ')}
     ORDER BY t.updated_at DESC`,
    params,
  );
  return rows.map((r) => ({
    id: r.id, subject: r.subject, status: r.status, priority: r.priority,
    createdAt: r.created_at, updatedAt: r.updated_at,
    lastMessage: r.last_message, lastMessageAt: r.last_message_at,
    unreadCount: r.unread_count,
  }));
}

// ── List tickets (admin) ──────────────────────────────────────────────────────

async function listTickets({ status, search, page = 1, limit = 20, userId, isAdmin } = {}) {
  const offset = (page - 1) * limit;
  const params = [];
  let where = 'WHERE 1=1';
  let idx = 1;

  // Non-admin staff only see their assigned tickets
  if (!isAdmin) {
    where += ` AND (t.assigned_to = $${idx} OR t.assigned_to IS NULL)`;
    params.push(userId);
    idx++;
  }

  if (status) {
    where += ` AND t.status = $${idx}`;
    params.push(status);
    idx++;
  }
  if (search) {
    where += ` AND (t.subject ILIKE $${idx} OR COALESCE(pp.shop_name, cu.full_name, u.phone, t.guest_id) ILIKE $${idx} OR t.id::text ILIKE $${idx})`;
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
     LEFT JOIN partner_profile pp ON pp.user_id = t.user_id
     ${where}`,
    params,
  );
  const agg = countRes.rows[0];

  const { rows } = await pool.query(
    `SELECT
       t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
       u.role                          AS user_role,
       pp.shop_name                    AS shop_name,
       COALESCE(pp.shop_name, cu.full_name, u.phone, 'Guest ' || RIGHT(t.guest_id, 6)) AS customer_name,
       u.phone                         AS customer_phone,
       t.guest_id                      AS guest_id,
       COUNT(m.id)::int                AS message_count,
       -- unread for the admin = customer messages (is_staff = false) not yet read
       COUNT(m.id) FILTER (WHERE m.is_staff = false AND m.read_at IS NULL)::int AS unread_count,
       -- Sort by latest activity (latest message timestamp)
       COALESCE(
         (SELECT sent_at FROM support_messages WHERE ticket_id = t.id ORDER BY sent_at DESC LIMIT 1),
         t.updated_at
       ) AS latest_activity
     FROM support_tickets t
     LEFT JOIN users u              ON u.id = t.user_id
     LEFT JOIN customer_user cu     ON cu.user_id = t.user_id
     LEFT JOIN partner_profile pp   ON pp.user_id = t.user_id
     LEFT JOIN support_messages m   ON m.ticket_id = t.id
     ${where}
     GROUP BY t.id, cu.full_name, u.phone, u.role, pp.shop_name
     ORDER BY
       CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
       latest_activity DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return {
    tickets: rows.map((r) => {
      const isPartner = r.user_role === 'PARTNER' || !!r.shop_name || (r.subject && r.subject.toLowerCase().includes('partner'));
      return {
        id:            r.id,
        subject:       r.subject,
        status:        r.status,
        priority:      r.priority,
        customerName:  r.customer_name ?? (isPartner ? 'Partner' : 'Guest'),
        customerPhone: r.customer_phone ?? '',
        guestId:       r.guest_id ?? null,
        isGuest:       !r.customer_phone && !!r.guest_id,
        isPartner:     isPartner,
        userRole:      r.user_role ?? (isPartner ? 'PARTNER' : 'CUSTOMER'),
        shopName:      r.shop_name ?? null,
        messageCount:  r.message_count,
        unreadCount:   r.unread_count,
        createdAt:     r.created_at,
        updatedAt:     r.updated_at,
      };
    }),
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
       u.role                          AS user_role,
       pp.shop_name                    AS shop_name,
       COALESCE(pp.shop_name, cu.full_name, u.phone, 'Guest ' || RIGHT(t.guest_id, 6)) AS customer_name,
       u.phone                         AS customer_phone,
       u.email                         AS customer_email
     FROM support_tickets t
     LEFT JOIN users u         ON u.id = t.user_id
     LEFT JOIN customer_user cu ON cu.user_id = t.user_id
     LEFT JOIN partner_profile pp ON pp.user_id = t.user_id
     WHERE t.id = $1`,
    [id],
  );
  if (rows.length === 0) throw new AppError('Ticket not found', 404, 'NOT_FOUND');

  const { rows: messages } = await pool.query(
    `SELECT m.id, m.body, m.is_staff, m.sent_at, m.read_at, m.guest_id, m.image_url,
            CASE
              WHEN m.is_staff = true THEN COALESCE(au.full_name, 'Support')
              WHEN u.role = 'PARTNER' THEN COALESCE(pp.shop_name, 'Partner')
              ELSE COALESCE(cu.full_name, u.phone, 'Guest ' || RIGHT(m.guest_id, 6), 'Customer')
            END AS sender_name,
            u.role AS sender_role
     FROM support_messages m
     LEFT JOIN users u         ON u.id = m.sender_id
     LEFT JOIN customer_user cu ON cu.user_id = m.sender_id
     LEFT JOIN partner_profile pp ON pp.user_id = m.sender_id
     LEFT JOIN admin_user au    ON au.user_id = m.sender_id
     WHERE m.ticket_id = $1
     ORDER BY m.sent_at ASC`,
    [id],
  );

  const t = rows[0];
  const isPartner = t.user_role === 'PARTNER' || !!t.shop_name || (t.subject && t.subject.toLowerCase().includes('partner'));
  
  // Generate fresh presigned URLs for all images
  const messagesWithFreshUrls = await Promise.all(
    messages.map(async (m) => {
      if (m.image_url) {
        try {
          const freshUrl = await getChatImageUrl(m.id, 3600); // 1 hour fresh link
          return { ...m, imageUrl: freshUrl };
        } catch (e) {
          console.error('Failed to generate fresh image URL:', e);
          return m;
        }
      }
      return m;
    })
  );
  
  return {
    id:            t.id,
    subject:       t.subject,
    status:        t.status,
    priority:      t.priority,
    customerName:  t.customer_name ?? (isPartner ? 'Partner' : 'Guest'),
    customerPhone: t.customer_phone ?? '',
    customerEmail: t.customer_email ?? '',
    guestId:       t.guest_id ?? null,
    isPartner:     isPartner,
    userRole:      t.user_role ?? (isPartner ? 'PARTNER' : 'CUSTOMER'),
    shopName:      t.shop_name ?? null,
    createdAt:     t.created_at,
    updatedAt:     t.updated_at,
    messages: messagesWithFreshUrls.map((m) => ({
      id:         m.id,
      body:       m.body,
      isStaff:    m.is_staff === true,
      senderName: m.sender_name,
      sentAt:     m.sent_at,
      readAt:     m.read_at,
      imageUrl:   m.image_url || null,
      isPartner:  m.sender_role === 'PARTNER' || (!m.is_staff && isPartner),
    })),
  };
}

// ── Add reply ─────────────────────────────────────────────────────────────────

async function addReply(ticketId, { senderId, guestId, body, imageUrl, isStaff = false }) {
  const { rows: tRows } = await pool.query(
    `SELECT id, status, user_id, guest_id, assigned_to FROM support_tickets WHERE id = $1`, [ticketId],
  );
  if (tRows.length === 0) throw new AppError('Ticket not found', 404, 'NOT_FOUND');
  const ticket = tRows[0];

  if (!isStaff) {
    // Customers may only write to their own ticket
    const owns = (senderId && ticket.user_id === senderId) ||
                 (guestId && ticket.guest_id && ticket.guest_id === guestId);
    if (!owns) throw new AppError('Not allowed to reply to this ticket', 403, 'FORBIDDEN');
    if (ticket.status === 'CLOSED') throw new AppError('This ticket is closed', 400, 'TICKET_CLOSED');
  }
  // Staff (admins, super admins, customer support) can reply to any ticket
  // Auto-assign to staff if ticket is unassigned
  if (isStaff && senderId && !ticket.assigned_to) {
    await pool.query(`UPDATE support_tickets SET assigned_to = $1 WHERE id = $2`, [senderId, ticketId]);
  }

  const { rows } = await pool.query(
    `INSERT INTO support_messages (ticket_id, sender_id, guest_id, body, image_url, is_staff)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [ticketId, senderId || null, isStaff ? null : (senderId ? null : guestId || null), body?.trim() || '', imageUrl, isStaff],
  );

  await pool.query(
    `UPDATE support_tickets
     SET updated_at = NOW(),
         status = CASE
           WHEN $1::boolean = true  AND status = 'CLOSED' THEN 'OPEN'
           WHEN $1::boolean = true  AND status = 'OPEN'     THEN 'IN_PROGRESS'
           WHEN $1::boolean = false AND status = 'RESOLVED' THEN 'OPEN'
           ELSE status
         END
     WHERE id = $2`,
    [isStaff, ticketId],
  );

  const m = rows[0];
  return {
    id: m.id,
    body: m.body,
    isStaff: m.is_staff === true,
    sentAt: m.sent_at,
    readAt: m.read_at,
    imageUrl: m.image_url || null,
  };
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
       COALESCE(cu.full_name, u.phone, 'Guest ' || RIGHT(t.guest_id, 6)) AS customer_name,
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
async function markMessagesRead(ticketId, { byStaff = true, userId, guestId } = {}) {
  const targetIsStaff = !byStaff; // the messages being marked read
  
  // Ownership check for customers/guests
  if (!byStaff) {
    const { rows: tRows } = await pool.query(
      `SELECT user_id, guest_id FROM support_tickets WHERE id = $1`,
      [ticketId]
    );
    if (tRows.length === 0) throw new AppError('Ticket not found', 404, 'NOT_FOUND');
    const ticket = tRows[0];
    const owns = (userId && ticket.user_id === userId) ||
                 (guestId && ticket.guest_id && ticket.guest_id === guestId);
    if (!owns) throw new AppError('Not allowed to mark this ticket as read', 403, 'FORBIDDEN');
  }
  
  await pool.query(
    `UPDATE support_messages
     SET read_at = NOW()
     WHERE ticket_id = $1 AND is_staff = $2 AND read_at IS NULL`,
    [ticketId, targetIsStaff],
  );
}

/** Record that someone is typing on a ticket (customers, guests and staff). */
async function recordTyping(ticketId, { isStaff, userId, guestId }) {
  try {
    // Ownership check for customers/guests
    if (!isStaff) {
      const { rows: tRows } = await pool.query(
        `SELECT user_id, guest_id FROM support_tickets WHERE id = $1`,
        [ticketId]
      );
      if (tRows.length > 0) {
        const ticket = tRows[0];
        const owns = (userId && ticket.user_id === userId) ||
                     (guestId && ticket.guest_id && ticket.guest_id === guestId);
        if (!owns) return; // Silently ignore typing from non-owners
      }
    }
    
    await pool.query(
      `INSERT INTO support_typing (ticket_id, is_staff, typed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (ticket_id, is_staff) DO UPDATE SET typed_at = NOW()`,
      [ticketId, !!isStaff],
    );
  } catch (e) {
    console.error('recordTyping error:', e.message);
  }
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

// ── Delete ticket (admin only) ───────────────────────────────────────────────────

async function deleteTicket(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Delete messages first (cascade if FK is set, but explicit is safer)
    await client.query('DELETE FROM support_messages WHERE ticket_id = $1', [id]);
    // Delete the ticket
    const { rowCount } = await client.query('DELETE FROM support_tickets WHERE id = $1', [id]);
    await client.query('COMMIT');
    if (rowCount === 0) throw new AppError('Ticket not found', 404, 'NOT_FOUND');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Get previous tickets for a customer ───────────────────────────────────────

async function getPreviousTicketsForCustomer(userId, guestId, currentTicketId) {
  const conds = [];
  const params = [];
  let idx = 1;
  
  if (userId) {
    conds.push(`t.user_id = $${idx++}`);
    params.push(userId);
  }
  if (guestId) {
    conds.push(`t.guest_id = $${idx++}`);
    params.push(guestId);
  }
  
  if (currentTicketId) {
    conds.push(`t.id != $${idx++}`);
    params.push(currentTicketId);
  }
  
  const { rows } = await pool.query(
    `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
            COUNT(m.id)::int AS message_count
     FROM support_tickets t
     LEFT JOIN support_messages m ON m.ticket_id = t.id
     WHERE ${conds.join(' AND ')}
     GROUP BY t.id
     ORDER BY t.updated_at DESC
     LIMIT 5`,
    params,
  );
  
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    status: r.status,
    messageCount: r.message_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ── Upload chat image service ───────────────────────────────────────────────────

// This is handled in the controller directly with saveChatImage from storage

module.exports = {
  listTickets,
  getTicket,
  addReply,
  updateStatus,
  createTicket,
  getCustomerTickets,
  claimGuestTickets,
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
  deleteTicket,
  getPreviousTicketsForCustomer,
};
