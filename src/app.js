const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { allowedOrigins, isOriginAllowed, nodeEnv, trustProxy, isProduction } = require('./core/config');
const { pool } = require('./core/config/database');
const { errorHandler } = require('./core/middleware/error_handler');
const { createRateLimiter } = require('./core/middleware/rate_limiter');
const { cleanupExpiredTokens } = require('./features/auth/token.service');

// Auto-migrate database on startup
async function autoMigrate() {
  try {
    console.log('[Migration] Starting auto-migration...');

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) UNIQUE NOT NULL,
        full_name VARCHAR(255),
        password VARCHAR(255),
        role VARCHAR(50) DEFAULT 'CUSTOMER',
        is_verified BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        otp_code VARCHAR(10),
        otp_expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Users table');

    // Add is_active column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    } catch (e) {
      // Column might already exist
    }

    // Add email column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE`);
    } catch (e) {
      // Column might already exist
    }

    // Add password_hash column if it doesn't exist (migrate from password)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
      await pool.query(`UPDATE users SET password_hash = password WHERE password_hash IS NULL AND password IS NOT NULL`);
    } catch (e) {
      // Column might already exist
    }

    // Add password_plain column for admin visibility (stored alongside the hash)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain VARCHAR(255)`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance DECIMAL(12, 2) DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0`);
    } catch (e) {
      // Column might already exist
    }

    // Create products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_id UUID REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        price DECIMAL(10, 2) NOT NULL,
        old_price DECIMAL(10, 2),
        stock_quantity INTEGER DEFAULT 0,
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Products table');

    // Add old_price column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price DECIMAL(10, 2)`);
    } catch (e) {
      // Column might already exist
    }

    // ── Ensure full products schema (additive, safe) ───────────────────────
    // The service layer expects these columns. Add them if the table was
    // created with an older minimal schema, and backfill from legacy columns.
    const productColumns = [
      `name_en VARCHAR(255)`,
      `name_am VARCHAR(255)`,
      `name_om VARCHAR(255)`,
      `description_en TEXT`,
      `description_am TEXT`,
      `description_om TEXT`,
      `delivery_info TEXT`,
      `price_cents INTEGER DEFAULT 0`,
      `discount_cents INTEGER DEFAULT 0`,
      `sku VARCHAR(100)`,
      `stock INTEGER DEFAULT 0`,
      `status VARCHAR(50) DEFAULT 'PENDING'`,
      `is_visible BOOLEAN DEFAULT true`,
      `rating_avg DECIMAL(3, 2) DEFAULT 0`,
      `rating_count INTEGER DEFAULT 0`,
      `sold_count INTEGER DEFAULT 0`,
      `brand_id UUID`,
    ];
    for (const colDef of productColumns) {
      try {
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ${colDef}`);
      } catch (e) {
        // column might already exist
      }
    }

    // Make legacy NOT NULL columns safe so inserts via the new schema work
    try {
      await pool.query(`ALTER TABLE products ALTER COLUMN name DROP NOT NULL`);
    } catch (e) { }
    try {
      await pool.query(`ALTER TABLE products ALTER COLUMN price DROP NOT NULL`);
    } catch (e) { }

    // Backfill new columns from legacy ones where available
    try {
      await pool.query(`UPDATE products SET name_en = COALESCE(name_en, name) WHERE name_en IS NULL AND name IS NOT NULL`);
      await pool.query(`UPDATE products SET description_en = COALESCE(description_en, description) WHERE description_en IS NULL AND description IS NOT NULL`);
      await pool.query(`UPDATE products SET price_cents = COALESCE(price_cents, CAST(price * 100 AS INTEGER)) WHERE price_cents IS NULL AND price IS NOT NULL`);
      await pool.query(`UPDATE products SET stock = COALESCE(stock, stock_quantity) WHERE stock IS NULL AND stock_quantity IS NOT NULL`);
      await pool.query(`UPDATE products SET is_visible = COALESCE(is_visible, is_active) WHERE is_visible IS NULL`);
    } catch (e) {
      // backfill best-effort
    }
    console.log('[Migration] ✓ Products table (full schema ensured)');

    // Create product_images table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Product images table');
    try {
      await pool.query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
    } catch (e) { }

    // Create product_variants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        value VARCHAR(100) NOT NULL,
        price_modifier INTEGER DEFAULT 0,
        stock INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Product variants table');

    // Create product_reactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reaction_type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, user_id)
      );
    `);
    console.log('[Migration] ✓ Product reactions table');

    // Create seller_offers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seller_offers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        seller_id UUID REFERENCES users(id) ON DELETE CASCADE,
        price INTEGER NOT NULL,
        badge VARCHAR(50) DEFAULT 'Standard',
        badge_color VARCHAR(20) DEFAULT '#27AE60',
        delivery_info VARCHAR(255) DEFAULT 'Standard delivery',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Seller offers table');

    // Create reviews table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL,
        comment TEXT,
        is_approved BOOLEAN DEFAULT true,
        helpful_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Reviews table');

    // Create categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(50) PRIMARY KEY,
        name_en VARCHAR(255) NOT NULL,
        name_am VARCHAR(255),
        name_om VARCHAR(255),
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        icon VARCHAR(255),
        color VARCHAR(7),
        parent_id VARCHAR(50) REFERENCES categories(id),
        order_index INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Categories table');

    // Create flash_deals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flash_deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        discount_percent INTEGER NOT NULL,
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Flash deals table');

    // Create flash_deal_products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flash_deal_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        flash_deal_id UUID NOT NULL REFERENCES flash_deals(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(flash_deal_id, product_id)
      );
    `);
    console.log('[Migration] ✓ Flash deal products table');

    // Create flash_deal_categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flash_deal_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        flash_deal_id UUID NOT NULL REFERENCES flash_deals(id) ON DELETE CASCADE,
        category_id VARCHAR(50) NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(flash_deal_id, category_id)
      );
    `);
    console.log('[Migration] ✓ Flash deal categories table');

    // Add starts_at column if it doesn't exist (migrate from start_time)
    try {
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS starts_at TIMESTAMP`);
      await pool.query(`UPDATE flash_deals SET starts_at = start_time WHERE starts_at IS NULL AND start_time IS NOT NULL`);
    } catch (e) {
      // Column might already exist
    }

    // Add ends_at column if it doesn't exist (migrate from end_time)
    try {
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS ends_at TIMESTAMP`);
      await pool.query(`UPDATE flash_deals SET ends_at = end_time WHERE ends_at IS NULL AND end_time IS NOT NULL`);
    } catch (e) {
      // Column might already exist
    }

    // Create orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        total_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING',
        shipping_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Orders table');

    // Ensure orders table has all admin-needed columns
    try { await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100)`); } catch (e) { }
    try { await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_cents INTEGER`); } catch (e) { }
    try {
      // Backfill total_amount from total_cents if needed
      await pool.query(`UPDATE orders SET total_amount = total_cents / 100.0 WHERE total_amount IS NULL AND total_cents IS NOT NULL`);
    } catch (e) { }

    // Create order_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        quantity INTEGER NOT NULL,
        price_at_order DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Order items table');

    // Create notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        body TEXT,
        type VARCHAR(50),
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Notifications table');
    try { await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB`); } catch (e) { }
    try { await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false`); } catch (e) { }

    // Create wallet_transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        amount DECIMAL(10,2) NOT NULL,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'COMPLETED',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Wallet transactions table');

    // Create indexes for wallet_transactions
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(type)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created ON wallet_transactions(created_at DESC)`);
      console.log('[Migration] ✓ Wallet transactions indexes');
    } catch (e) {
      console.log('[Migration] Wallet transactions indexes may already exist');
    }

    // Create payment_methods table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        icon_url VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Payment methods table');

    // Seed default payment methods if table is empty
    const paymentMethodsCount = await pool.query('SELECT COUNT(*) as count FROM payment_methods');
    if (parseInt(paymentMethodsCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO payment_methods (name, code, icon_url, display_order) VALUES
        ('TeleBirr', 'TELEBIRR', 'https://via.placeholder.com/40/1E88E5/FFFFFF?text=TB', 1),
        ('CBE Birr', 'CBE', 'https://via.placeholder.com/40/4CAF50/FFFFFF?text=CBE', 2),
        ('Awash Bank', 'AWASH', 'https://via.placeholder.com/40/FF9800/FFFFFF?text=AW', 3),
        ('Abyssinia Bank', 'ABYSSINIA', 'https://via.placeholder.com/40/9C27B0/FFFFFF?text=AB', 4)
      `);
      console.log('[Migration] ✓ Payment methods seeded');
    }

    // Create fcm_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, token)
      );
    `);
    console.log('[Migration] ✓ FCM tokens table');

    // Create otp_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) NOT NULL,
        code VARCHAR(10) NOT NULL,
        type VARCHAR(20) DEFAULT 'REGISTER',
        expires_at TIMESTAMP NOT NULL,
        is_used BOOLEAN DEFAULT false,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ OTP codes table');

    // Create customer_user table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_user (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        full_name VARCHAR(255),
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Customer user table');

    // Create admin_user table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_user (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        admin_role VARCHAR(50),
        full_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Add allowed_pages + last_login for the Manage Users admin feature
    try {
      await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS allowed_pages JSONB DEFAULT '[]'::jsonb`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE`);
      await pool.query(`UPDATE users u SET role = au.admin_role FROM admin_user au WHERE au.user_id = u.id AND au.admin_role IS NOT NULL AND (u.role IS NULL OR u.role = 'CUSTOMER')`);
    } catch (e) { /* columns may already exist */ }
    console.log('[Migration] ✓ Admin user table');

    // Create telegram_chat_ids table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_chat_ids (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) UNIQUE NOT NULL,
        chat_id BIGINT NOT NULL,
        username VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Telegram chat IDs table');

    // Create partner_profile table (joined by products query)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_profile (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        owner_name VARCHAR(255),
        business_name VARCHAR(255),
        shop_name VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        logo_url TEXT,
        description TEXT,
        address TEXT,
        city VARCHAR(100),
        rating_avg DECIMAL(3, 2) DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        total_orders INTEGER DEFAULT 0,
        total_sales DECIMAL(12, 2) DEFAULT 0,
        is_verified BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Ensure business_name exists even on older schemas that only had shop_name
    try {
      const partnerCols = [
        `business_name VARCHAR(255)`,
        `shop_name VARCHAR(255)`,
        `owner_name VARCHAR(255)`,
        `city VARCHAR(100)`,
        `address TEXT`,
        `phone VARCHAR(20)`,
        `email VARCHAR(255)`,
        `logo_url TEXT`,
        `description TEXT`,
        `rating_avg DECIMAL(3, 2) DEFAULT 0`,
        `rating_count INTEGER DEFAULT 0`,
        `total_orders INTEGER DEFAULT 0`,
        `total_sales DECIMAL(12, 2) DEFAULT 0`,
        `is_verified BOOLEAN DEFAULT false`,
        `is_active BOOLEAN DEFAULT true`,
      ];
      for (const colDef of partnerCols) {
        await pool.query(`ALTER TABLE partner_profile ADD COLUMN IF NOT EXISTS ${colDef}`);
      }
      await pool.query(`UPDATE partner_profile SET business_name = COALESCE(business_name, shop_name) WHERE business_name IS NULL AND shop_name IS NOT NULL`);
    } catch (e) { }
    console.log('[Migration] ✓ Partner profile table');

    // Ensure categories has the full column set used by the products query
    try {
      await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_en VARCHAR(255)`);
      await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS slug VARCHAR(255)`);
      await pool.query(`UPDATE categories SET name_en = COALESCE(name_en, name) WHERE name_en IS NULL AND name IS NOT NULL`);
    } catch (e) { }
    console.log('[Migration] ✓ Categories (full columns ensured)');
    try {
      const { rows: catRows } = await pool.query('SELECT COUNT(*)::int AS count FROM categories');
      if ((catRows[0]?.count ?? 0) === 0) {
        await pool.query(`
          INSERT INTO categories (id, name_en, name_am, name_om, slug, description, order_index, is_active)
          VALUES
            ('electronics', 'Electronics', 'ኤሌክትሮኒክስ', 'Elektirooniksii', 'electronics', 'Phones, computers, and electronics', 1, true),
            ('fashion', 'Fashion', 'ፋሽን', 'Faashinii', 'fashion', 'Clothing, shoes, and apparel', 2, true),
            ('home-kitchen', 'Home & Kitchen', 'የቤት እቃዎች', 'Mana fi Kushiinaa', 'home-kitchen', 'Furniture, kitchenware, and decor', 3, true),
            ('beauty', 'Beauty & Health', 'ውበት እና ጤና', 'Miidhagina fi Fayyaa', 'beauty', 'Cosmetics, skincare, and personal care', 4, true),
            ('groceries', 'Groceries', 'ግሮሰሪ', 'Groosarii', 'groceries', 'Food, beverages, and household supplies', 5, true)
          ON CONFLICT (id) DO NOTHING;
        `);
        console.log('[Migration] ✓ Categories seeded');
      }
    } catch (e) { }

    // Create support_tickets table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
        guest_id   VARCHAR(100),
        subject    VARCHAR(500) NOT NULL,
        status     VARCHAR(30) DEFAULT 'OPEN',
        priority   VARCHAR(20) DEFAULT 'MEDIUM',
        assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Add guest_id column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS guest_id VARCHAR(100)`);
    } catch (e) { }
    // Add assigned_to column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL`);
    } catch (e) { }
    console.log('[Migration] ✓ Support tickets table');

    // Create support_messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
        guest_id  VARCHAR(100),
        body      TEXT NOT NULL,
        is_staff  BOOLEAN DEFAULT false,
        sent_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON support_messages(ticket_id)`);
    // Add guest_id column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS guest_id VARCHAR(100)`);
    } catch (e) { }
    // Add image_url column for chat images
    try {
      await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS image_url TEXT`);
    } catch (e) { }
    // Read receipts + typing indicator
    await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE`);
    try {
      // One row per ticket per side (staff / customer). Works for guests too,
      // because it no longer depends on a user id.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS support_typing (
          ticket_id UUID NOT NULL,
          is_staff  BOOLEAN NOT NULL,
          typed_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      // Upgrade the old (ticket_id, user_id) layout. Typing rows are short-lived, so clearing is safe.
      await pool.query(`ALTER TABLE support_typing DROP CONSTRAINT IF EXISTS support_typing_pkey`);
      await pool.query(`ALTER TABLE support_typing DROP COLUMN IF EXISTS user_id`);
      await pool.query(`DELETE FROM support_typing`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_support_typing_ticket_side ON support_typing (ticket_id, is_staff)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_guest_id ON support_tickets (guest_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets (user_id)`);
      console.log('[Migration] ✓ Support typing table');

      // Create reviews table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id UUID REFERENCES products(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
          title VARCHAR(255) NOT NULL,
          body TEXT NOT NULL,
          helpful INTEGER DEFAULT 0,
          seller_reply TEXT,
          verified BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id)`);
      console.log('[Migration] ✓ Reviews table');

      // ── One-time cleanup: merge duplicate open guest tickets into the newest one ──
      try {
        await pool.query(`
          WITH ranked AS (
            SELECT id, guest_id,
                   FIRST_VALUE(id) OVER (PARTITION BY guest_id ORDER BY updated_at DESC) AS keep_id
            FROM support_tickets
            WHERE guest_id IS NOT NULL AND user_id IS NULL AND status <> 'CLOSED'
          )
          UPDATE support_messages m
          SET ticket_id = r.keep_id
          FROM ranked r
          WHERE m.ticket_id = r.id AND r.id <> r.keep_id;

          DELETE FROM support_tickets t
          USING (
            SELECT id,
                   FIRST_VALUE(id) OVER (PARTITION BY guest_id ORDER BY updated_at DESC) AS keep_id
            FROM support_tickets
            WHERE guest_id IS NOT NULL AND user_id IS NULL AND status <> 'CLOSED'
          ) r
          WHERE t.id = r.id AND r.id <> r.keep_id;
        `);
        console.log('[Migration] ✓ Cleaned up duplicate guest support tickets');
      } catch (cleanErr) {
        console.warn('[Migration] Guest tickets cleanup notice:', cleanErr.message);
      }
    } catch (e) {
      console.log('[Migration] Support typing table error:', e.message);
    }

    // Create bids table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bids (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title         VARCHAR(255) NOT NULL,
        product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
        start_price   DECIMAL(12, 2) NOT NULL,
        min_increment DECIMAL(12, 2) NOT NULL DEFAULT 10,
        starts_at     TIMESTAMP NOT NULL,
        ends_at       TIMESTAMP NOT NULL,
        status        VARCHAR(20) DEFAULT 'DRAFT',
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Bids table');

    // Create bid_entries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bid_entries (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bid_id        UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
        user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
        amount        DECIMAL(12, 2) NOT NULL,
        bid_time      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bid_entries_bid_id ON bid_entries(bid_id)`);
    console.log('[Migration] ✓ Bid entries table');

    // Create auctions table (for new auction system)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS auctions (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title                 VARCHAR(255) NOT NULL,
          description           TEXT,
          product_id            UUID REFERENCES products(id) ON DELETE SET NULL,
          start_price_cents     INTEGER NOT NULL,
          current_bid_cents     INTEGER NOT NULL,
          current_bidder_id     UUID REFERENCES users(id) ON DELETE SET NULL,
          min_bid_increment_cents INTEGER NOT NULL DEFAULT 1000,
          starts_at             TIMESTAMP NOT NULL,
          ends_at               TIMESTAMP NOT NULL,
          status                VARCHAR(20) DEFAULT 'ACTIVE',
          created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_auctions_ends_at ON auctions(ends_at)`);
      console.log('[Migration] ✓ Auctions table');
    } catch (e) {
      console.log('[Migration] ⚠ Auctions table already exists or error:', e.message);
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS auction_bids (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          auction_id       UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
          user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          bid_amount_cents INTEGER NOT NULL,
          bid_time         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_auction_bids_auction_id ON auction_bids(auction_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_auction_bids_user_id ON auction_bids(user_id)`);
      console.log('[Migration] ✓ Auction bids table');
    } catch (e) {
      console.log('[Migration] ⚠ Auction bids table already exists or error:', e.message);
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wishlist (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, product_id)
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_wishlist_product_id ON wishlist(product_id)`);
      console.log('[Migration] ✓ Wishlist table');
    } catch (e) {
      console.log('[Migration] ⚠ Wishlist table already exists or error:', e.message);
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
          title      VARCHAR(255),
          comment    TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, product_id)
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating)`);
      console.log('[Migration] ✓ Reviews table');
    } catch (e) {
      console.log('[Migration] ⚠ Reviews table already exists or error:', e.message);
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS recently_viewed (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          viewed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, product_id)
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_recently_viewed_user_id ON recently_viewed(user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_recently_viewed_product_id ON recently_viewed(product_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_recently_viewed_viewed_at ON recently_viewed(viewed_at DESC)`);
      console.log('[Migration] ✓ Recently viewed table');
    } catch (e) {
      console.log('[Migration] ⚠ Recently viewed table already exists or error:', e.message);
    }

    // Create bid_entries table (old system, keep for compatibility)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bid_entries (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bid_id     UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
        user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
        amount     DECIMAL(12, 2) NOT NULL,
        placed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bid_entries_bid_id ON bid_entries(bid_id)`);

    // Create cart_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 1,
        price_at_add INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      );
    `);

    // Create payment_methods table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        icon_url TEXT,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    try {
      const { rows: pmRows } = await pool.query('SELECT COUNT(*)::int AS count FROM payment_methods');
      if ((pmRows[0]?.count ?? 0) === 0) {
        await pool.query(`
          INSERT INTO payment_methods (name, code, icon_url, display_order, is_active)
          VALUES
            ('Telebirr', 'telebirr', 'https://upload.wikimedia.org/wikipedia/commons/4/42/Telebirr_Logo.png', 1, true),
            ('CBE Birr', 'cbe_birr', 'https://upload.wikimedia.org/wikipedia/commons/e/ea/Commercial_Bank_of_Ethiopia_logo.png', 2, true),
            ('Chapa', 'chapa', null, 3, true),
            ('Awash Bank', 'awash', null, 4, true),
            ('Cash on Delivery', 'cod', null, 5, true)
          ON CONFLICT (code) DO NOTHING;
        `);
      }
    } catch (e) { }
    console.log('[Migration] ✓ Bid entries table');

    console.log('[Migration] ✅ Auto-migration completed successfully!');

    // Create support_settings table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS support_settings (
          id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
          welcome_message TEXT NOT NULL DEFAULT 'Hello! 👋 Welcome to Ema Store customer support. How can we help you today?',
          is_auto_reply_enabled BOOLEAN DEFAULT true,
          quick_starters JSONB DEFAULT '["Track my order", "Payment issue", "Return item", "Speak to agent"]'::jsonb,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await pool.query(`
        INSERT INTO support_settings (id) VALUES ('default')
        ON CONFLICT (id) DO NOTHING
      `);
      console.log('[Migration] ✓ Support settings table');
    } catch (e) {
      console.log('[Migration] ⚠ Support settings table already exists or error:', e.message);
    }

    // Create support_default_messages table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS support_default_messages (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title      VARCHAR(100) NOT NULL,
          body       TEXT         NOT NULL,
          sort_order INT          NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      // Drop legacy icon column if it exists (idempotent)
      await pool.query(`ALTER TABLE support_default_messages DROP COLUMN IF EXISTS icon`);
      console.log('[Migration] ✓ Support default messages table');
    } catch (e) {
      console.log('[Migration] ⚠ Support default messages table:', e.message);
    }

    // Create coupons table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS coupons (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code VARCHAR(50) UNIQUE NOT NULL,
          discount_type VARCHAR(20) NOT NULL DEFAULT 'PERCENT',
          discount_value NUMERIC(10, 2) NOT NULL,
          min_order_cents INTEGER DEFAULT 0,
          max_discount_cents INTEGER DEFAULT 0,
          expires_at TIMESTAMP WITH TIME ZONE,
          usage_limit INTEGER DEFAULT 1000,
          used_count INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      console.log('[Migration] ✓ Coupons table');
    } catch (e) {
      console.log('[Migration] ⚠ Coupons table:', e.message);
    }

    // Create wheel_slices table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wheel_slices (
          id SERIAL PRIMARY KEY,
          slice_index INTEGER NOT NULL,
          label VARCHAR(100) NOT NULL,
          reward_type VARCHAR(50) NOT NULL,
          reward_value NUMERIC(10, 2) DEFAULT 0,
          coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
          probability_weight INTEGER NOT NULL DEFAULT 10,
          color_hex VARCHAR(20) NOT NULL DEFAULT '#0F6841',
          is_active BOOLEAN DEFAULT true
        )
      `);
      console.log('[Migration] ✓ Wheel slices table');
    } catch (e) {
      console.log('[Migration] ⚠ Wheel slices table:', e.message);
    }

    // Create user_coupons table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_coupons (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          coupon_id UUID REFERENCES coupons(id) ON DELETE CASCADE,
          is_used BOOLEAN DEFAULT false,
          used_at TIMESTAMP WITH TIME ZONE,
          claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      console.log('[Migration] ✓ User coupons table');
    } catch (e) {
      console.log('[Migration] ⚠ User coupons table:', e.message);
    }

    // Create user_spins table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_spins (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          spins_today INTEGER DEFAULT 0,
          last_spin_date DATE DEFAULT CURRENT_DATE
        )
      `);
      console.log('[Migration] ✓ User spins table');
    } catch (e) {
      console.log('[Migration] ⚠ User spins table:', e.message);
    }

    // Seed default wheel slices if empty
    try {
      const { rows: sliceCount } = await pool.query('SELECT COUNT(*) FROM wheel_slices');
      if (parseInt(sliceCount[0].count, 10) === 0) {
        await pool.query(`
          INSERT INTO wheel_slices (slice_index, label, reward_type, reward_value, probability_weight, color_hex) VALUES
          (0, '10% OFF', 'COUPON', 10, 25, '#0F6841'),
          (1, '50 Birr', 'COUPON', 50, 20, '#F1C967'),
          (2, 'Free Delivery', 'COUPON', 0, 15, '#1E293B'),
          (3, 'Try Again', 'NONE', 0, 25, '#94A3B8'),
          (4, '20% OFF', 'COUPON', 20, 10, '#E11D48'),
          (5, '100 Birr', 'COUPON', 100, 5, '#8B5CF6'),
          (6, '5% OFF', 'COUPON', 5, 30, '#0284C7'),
          (7, '20 Coins', 'COINS', 20, 15, '#D97706')
        `);
        console.log('[Migration] ✓ Wheel slices seeded');
      }
    } catch (e) {
      console.log('[Migration] ⚠ Wheel slices seeding:', e.message);
    }

    // Create about_content table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS about_content (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(255) NOT NULL,
          description TEXT,
          mission TEXT,
          vision TEXT,
          values TEXT,
          story TEXT,
          image_url TEXT,
          contact_email VARCHAR(255),
          contact_phone VARCHAR(50),
          social_links JSONB,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[Migration] ✓ About content table');
    } catch (e) {
      console.log('[Migration] ⚠ About content table:', e.message);
    }
  } catch (error) {
    console.error('[Migration] ❌ Auto-migration failed:', error.message);
    // Don't exit - let the server start anyway
  }
}

// Run auto-migration before starting the server
autoMigrate();

// Start the auto-close job for support tickets
try {
  const { startAutoCloseJob } = require('./features/support/support.autoclose');
  startAutoCloseJob();
} catch (e) {
  console.warn('[App] Auto-close job skipped:', e.message);
}

// Initialise Firebase Admin SDK (gracefully skipped if key file is absent)
try {
  const { initFirebase } = require('./core/config/firebase');
  initFirebase();
} catch (e) {
  console.warn('[App] Firebase initialization skipped:', e.message);
}

// ── Feature routers ────────────────────────────────────────────────────────────
const authRouter = require('./features/auth/auth.router');
const notificationsRouter = require('./features/notifications/notifications.router');
const flashDealsRouter = require('./features/flash-deals/flash-deals.router');
const productsRouter = require('./features/products/products.router');
const uploadRouter = require('./features/upload/upload.router');
const telegramRouter = require('./features/telegram/telegram.routes');
const referralRouter = require('./features/referral/referral.routes');
const specialOffersRouter = require('./features/special-offers/special-offers.router');
const customersRouter = require('./features/customers/customers.router');
const adminPartnersRouter = require('./features/admin/partners.router');
const adminUsersRouter = require('./features/users/users.router');
const bidsRouter = require('./features/bids/bids.router');
const supportRouter = require('./features/support/support.router');
const bannersRouter = require('./features/banners/banners.router');
const cartRouter = require('./features/cart/cart.router');
const ordersRouter = require('./features/orders/orders.router');
const walletRouter = require('./features/wallet/wallet.router');
const paymentMethodsRouter = require('./features/payment-methods/payment-methods.router');
const auctionsRouter = require('./features/auctions/auctions.router');
const wishlistRouter = require('./features/wishlist/wishlist.router');
const reviewsRouter = require('./features/reviews/reviews.router');
const recentlyViewedRouter = require('./features/recently-viewed/recently_viewed.router');
const marketingRouter = require('./features/marketing/marketing.router');
const aboutRouter = require('./features/about/about.router');

const app = express();

app.disable('x-powered-by');
// Real client IPs for rate limiters when behind Render/nginx.
app.set('trust proxy', trustProxy);

// ── Security headers ───────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // JSON API — no HTML to protect
    hsts: isProduction
      ? { maxAge: 15552000, includeSubDomains: true, preload: true }
      : false,
  }),
);

// ── CORS — allowlisted origins only; no Origin header (mobile apps) allowed ────
// NOTE: 'x-bot-key' is intentionally NOT in allowedHeaders — browsers must
// never send it; it is for server-to-server / bot use only.
const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Requested-With',
    'x-guest-id', 'X-Guest-Id', 'x-device-id', 'X-Device-Id',
  ],
  exposedHeaders: ['X-Total-Count'],
  credentials: false,
  optionsSuccessStatus: 204,
  preflightContinue: false,
};
app.use(cors(corsOptions));
// cors() already answers preflight OPTIONS — no app.options('*') needed
// (that syntax throws on Express 5 / path-to-regexp v8).

// ── Request logging — method, path and status only; no headers/body/origin ────
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/v1/health') return next();
  res.on('finish', () => {
    console.log(`[Request] ${req.method} ${req.path} -> ${res.statusCode}`);
  });
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ── Global API rate limit: 300 req/min per IP ─────────────────────────────────
const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  code: 'TOO_MANY_REQUESTS',
});
app.use('/api', apiLimiter);

// ── Static files (uploads) — never serve dotfiles, indexes or HTML ─────────────
app.use(
  '/uploads',
  express.static('public/uploads', {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }),
);

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', environment: nodeEnv, database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'not connected' });
  }
});

app.get('/api/v1/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', environment: nodeEnv, database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'not connected' });
  }
});

// ── API v1 ─────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/flash-deals', flashDealsRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/categories', (req, res, next) => { req.url = '/categories' + (req.url === '/' ? '' : req.url); productsRouter(req, res, next); });
app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/telegram', telegramRouter);
app.use('/api/v1/referral', referralRouter);
app.use('/api/v1/special-offers', specialOffersRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/admin', adminPartnersRouter);
app.use('/api/v1/admin', adminUsersRouter);
app.use('/api/v1/bids', bidsRouter);
app.use('/api/v1/support', supportRouter);
app.use('/api/v1/banners', bannersRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/wallet', walletRouter);
app.use('/api/v1/payment-methods', paymentMethodsRouter);
app.use('/api/v1/auctions', bidsRouter);
app.use('/api/v1/wishlist', wishlistRouter);
app.use('/api/v1/reviews', reviewsRouter);
app.use('/api/v1/recently-viewed', recentlyViewedRouter);
app.use('/api/v1/marketing', marketingRouter);
app.use('/api/v1/about', aboutRouter);

// ── Partner routes ─────────────────────────────────────────────────────────────
const partnerAuthRouter = require('./features/partner/auth/auth.router');
const partnerDashboardRouter = require('./features/partner/dashboard/dashboard.router');
const partnerProductsRouter = require('./features/partner/products/products.router');
const partnerOrdersRouter = require('./features/partner/orders/orders.router');
const partnerInventoryRouter = require('./features/partner/inventory/inventory.router');
const partnerEarningsRouter = require('./features/partner/earnings/earnings.router');
const partnerProfileRouter = require('./features/partner/profile/profile.router');
const partnerReviewsRouter = require('./features/partner/reviews/reviews.router');
const partnerPromotionsRouter = require('./features/partner/promotions/promotions.router');
const partnerSettingsRouter = require('./features/partner/settings/settings.router');

app.use('/api/v1/partner/auth', partnerAuthRouter);
app.use('/api/v1/partner/dashboard', partnerDashboardRouter);
app.use('/api/v1/partner/products', partnerProductsRouter);
app.use('/api/v1/partner/orders', partnerOrdersRouter);
app.use('/api/v1/partner/inventory', partnerInventoryRouter);
app.use('/api/v1/partner/earnings', partnerEarningsRouter);
app.use('/api/v1/partner/profile', partnerProfileRouter);
app.use('/api/v1/partner/reviews', partnerReviewsRouter);
app.use('/api/v1/partner/promotions', partnerPromotionsRouter);
app.use('/api/v1/partner/settings', partnerSettingsRouter);

// ── Root ───────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    message: 'Ema Store Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api/v1'
    }
  });
});

// ── 404 for unknown API paths ──────────────────────────────────────────────────
app.use('/api', (_req, res) =>
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Not found' }),
);

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

// ── Refresh-token housekeeping: purge rows expired >7 days ago, every 6h ──────
setInterval(() => {
  cleanupExpiredTokens().catch((err) =>
    console.error('[tokens] cleanup failed:', err.code || err.name),
  );
}, 6 * 60 * 60 * 1000).unref();

module.exports = app;
