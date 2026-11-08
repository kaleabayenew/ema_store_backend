const { ok, created, error } = require('../../core/utils/response');
const { pool } = require('../../core/config/database');

// GET /api/v1/about - Get active about content
const getAboutContent = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM about_content
      WHERE is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) {
      return ok(res, { content: null });
    }

    ok(res, { content: rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/about - Create about content (admin)
const createAboutContent = async (req, res, next) => {
  try {
    const { title, description, mission, vision, values, story, image_url, contact_email, contact_phone, social_links } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO about_content (title, description, mission, vision, values, story, image_url, contact_email, contact_phone, social_links, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
      RETURNING *
    `, [title, description, mission, vision, values, story, image_url, contact_email, contact_phone, social_links]);

    created(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/about/all - Get all about content (admin)
const getAllAboutContent = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM about_content
      ORDER BY created_at DESC
    `);

    ok(res, { content: rows });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/about/:id - Update about content (admin)
const updateAboutContent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, mission, vision, values, story, image_url, contact_email, contact_phone, social_links, is_active } = req.body;

    const { rows } = await pool.query(`
      UPDATE about_content
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          mission = COALESCE($3, mission),
          vision = COALESCE($4, vision),
          values = COALESCE($5, values),
          story = COALESCE($6, story),
          image_url = COALESCE($7, image_url),
          contact_email = COALESCE($8, contact_email),
          contact_phone = COALESCE($9, contact_phone),
          social_links = COALESCE($10, social_links),
          is_active = COALESCE($11, is_active),
          updated_at = NOW()
      WHERE id = $12
      RETURNING *
    `, [title, description, mission, vision, values, story, image_url, contact_email, contact_phone, social_links, is_active, id]);

    if (rows.length === 0) {
      return error(res, 'About content not found', 404, 'NOT_FOUND');
    }

    ok(res, { content: rows[0] });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/about/:id - Delete about content (admin)
const deleteAboutContent = async (req, res, next) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM about_content WHERE id = $1', [id]);

    ok(res, { message: 'About content deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAboutContent,
  createAboutContent,
  getAllAboutContent,
  updateAboutContent,
  deleteAboutContent,
};
