const { Pool } = require('pg');

const connectionString = 'postgresql://neondb_owner:npg_0MUP7WSbEfIt@ep-odd-sea-ap1jqty4-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({ connectionString });

async function migrate() {
  console.log('Starting Neon database migration...');

  try {
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
