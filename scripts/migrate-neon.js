const { Pool } = require('pg');

const connectionString = 'postgresql://neondb_owner:npg_0MUP7WSbEfIt@ep-odd-sea-ap1jqty4-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({ connectionString });

async function migrate() {
  console.log('Starting Neon database migration...');

  try {
    // Drop tables to recreate with correct schema
    console.log('Dropping existing tables...');
    await pool.query('DROP TABLE IF EXISTS seller_offers CASCADE');
    await pool.query('DROP TABLE IF EXISTS product_specifications CASCADE');
    await pool.query('DROP TABLE IF EXISTS product_variants CASCADE');
    await pool.query('DROP TABLE IF EXISTS wishlist CASCADE');
    await pool.query('DROP TABLE IF EXISTS product_viewers CASCADE');
    await pool.query('DROP TABLE IF EXISTS product_reactions CASCADE');
    await pool.query('DROP TABLE IF EXISTS product_reviews CASCADE');
    await pool.query('DROP TABLE IF EXISTS brands CASCADE');
    await pool.query('DROP TABLE IF EXISTS categories CASCADE');
    await pool.query('DROP TABLE IF EXISTS products CASCADE');
    await pool.query('DROP TABLE IF EXISTS product_images CASCADE');
    console.log('✓ Tables dropped');

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
    console.log('✓ Users table created');

    // Add is_active column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
      console.log('✓ Added is_active column to users');
    } catch (e) {
      console.log('  (is_active column might already exist)');
    }

    // Add balance column for wallet
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance DECIMAL(10, 2) DEFAULT 0.00`);
      console.log('✓ Added balance column to users');
    } catch (e) {
      console.log('  (balance column might already exist)');
    }

    // Add coins column for rewards
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0`);
      console.log('✓ Added coins column to users');
    } catch (e) {
      console.log('  (coins column might already exist)');
    }

    // Add referral_code column
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE`);
      console.log('✓ Added referral_code column to users');
    } catch (e) {
      console.log('  (referral_code column might already exist)');
    }

    // Add referred_by column for tracking referrals
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id)`);
      console.log('✓ Added referred_by column to users');
    } catch (e) {
      console.log('  (referred_by column might already exist)');
    }

    // Add password_plain column
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain VARCHAR(255)`);
      console.log('✓ Added password_plain column to users');
    } catch (e) {
      console.log('  (password_plain column might already exist)');
    }

    // Add profile_image column for profile picture URL
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT`);
      console.log('✓ Added profile_image column to users');
    } catch (e) {
      console.log('  (profile_image column might already exist)');
    }

    // Create brands table (before products)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        logo_url TEXT,
        description TEXT,
        website_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Brands table created');

    // Create categories table (before products)
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
    console.log('✓ Categories table created');

    // Create products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_id UUID REFERENCES users(id),
        category VARCHAR(50),
        brand_id UUID REFERENCES brands(id),
        name_en VARCHAR(255) NOT NULL,
        name_am VARCHAR(255),
        name_om VARCHAR(255),
        description_en TEXT,
        description_am TEXT,
        description_om TEXT,
        delivery_info TEXT,
        price_cents INTEGER NOT NULL,
        discount_cents INTEGER DEFAULT 0,
        sku VARCHAR(100),
        stock INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'PENDING',
        is_visible BOOLEAN DEFAULT true,
        rating_avg DECIMAL(3, 2) DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        sold_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Products table created');

    // Add old_price column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price DECIMAL(10, 2)`);
      console.log('✓ Added old_price column to products');
    } catch (e) {
      console.log('  (old_price column might already exist)');
    }

    // Create product_images table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        is_primary BOOLEAN DEFAULT false,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Product images table created');

    // Create flash_deals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flash_deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        discount_percentage DECIMAL(5, 2) NOT NULL,
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Flash deals table created');

    // Add starts_at column if it doesn't exist (migrate from start_time)
    try {
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS starts_at TIMESTAMP`);
      await pool.query(`UPDATE flash_deals SET starts_at = start_time WHERE starts_at IS NULL AND start_time IS NOT NULL`);
      console.log('✓ Added starts_at column to flash_deals');
    } catch (e) {
      console.log('  (starts_at column might already exist)');
    }

    // Add ends_at column if it doesn't exist (migrate from end_time)
    try {
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS ends_at TIMESTAMP`);
      await pool.query(`UPDATE flash_deals SET ends_at = end_time WHERE ends_at IS NULL AND end_time IS NOT NULL`);
      console.log('✓ Added ends_at column to flash_deals');
    } catch (e) {
      console.log('  (ends_at column might already exist)');
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
    console.log('✓ Orders table created');

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
    console.log('✓ Order items table created');

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
    console.log('✓ Notifications table created');

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
    console.log('✓ FCM tokens table created');

    // Create referral_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(20) UNIQUE NOT NULL,
        total_uses INTEGER DEFAULT 0,
        max_uses INTEGER DEFAULT 100,
        reward_coins INTEGER DEFAULT 50,
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Referral codes table created');

    // Create partner_profile table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_profile (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        owner_name VARCHAR(255),
        business_name VARCHAR(255),
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
    console.log('✓ Partner profile table created');

    // Create special_offers table (for flash deals)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS special_offers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        discount_percentage DECIMAL(5, 2) NOT NULL,
        min_purchase DECIMAL(10, 2) DEFAULT 0,
        max_discount DECIMAL(10, 2),
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true,
        product_ids UUID[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Special offers table created');

    // Create product_reviews table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        helpful_count INTEGER DEFAULT 0,
        is_approved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, customer_id)
      );
    `);
    console.log('✓ Product reviews table created');

    // Create product_reactions table (like/dislike)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reaction_type VARCHAR(20) NOT NULL CHECK (reaction_type IN ('like', 'dislike')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, user_id)
      );
    `);
    console.log('✓ Product reactions table created');

    // Create product_viewers table (real-time viewers)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_viewers (
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        viewer_count INTEGER DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (product_id)
      );
    `);
    console.log('✓ Product viewers table created');

    // Create wishlist table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wishlist (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      );
    `);
    console.log('✓ Wishlist table created');

    // Create product_variants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100),
        price_cents INTEGER,
        stock INTEGER DEFAULT 0,
        attributes JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Product variants table created');

    // Create product_specifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_specifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        spec_key VARCHAR(255) NOT NULL,
        spec_value TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Product specifications table created');

    // Create seller_offers table (other sellers for same product)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seller_offers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        seller_id UUID NOT NULL REFERENCES users(id),
        seller_name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        rating DECIMAL(3, 2) DEFAULT 0,
        review_count INTEGER DEFAULT 0,
        badge VARCHAR(50),
        badge_color VARCHAR(7),
        delivery_info TEXT,
        is_cheapest BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Seller offers table created');

    console.log('\n✅ Neon database migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
