const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString = 'postgresql://neondb_owner:npg_0MUP7WSbEfIt@ep-odd-sea-ap1jqty4-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({ connectionString });

// Sample data
const providers = [
  {
    phone: '+251911123456',
    password: 'provider123',
    fullName: 'Abebe Kebede',
    businessName: 'Addis Prime Shop',
    email: 'abebe@addisprime.shop',
    description: 'Leading electronics and fashion retailer in Addis Ababa',
    address: 'Bole Road, Near Friendship Mall',
    city: 'Addis Ababa',
    rating: 4.8,
    reviewCount: 218,
    totalOrders: 450,
    totalSales: 1250000,
    isVerified: true,
  },
  {
    phone: '+251911234567',
    password: 'provider123',
    fullName: 'Mulualem Tesfaye',
    businessName: 'Merkato Central',
    email: 'mulualem@merkato.shop',
    description: 'Your one-stop shop for all household needs',
    address: 'Merkato, Section 3',
    city: 'Addis Ababa',
    rating: 4.9,
    reviewCount: 342,
    totalOrders: 780,
    totalSales: 2100000,
    isVerified: true,
  },
  {
    phone: '+251911345678',
    password: 'provider123',
    fullName: 'Kidanemariam Bekele',
    businessName: 'Bole Market',
    email: 'kidanemariam@bole.shop',
    description: 'Fashion and accessories for modern Ethiopian women',
    address: 'Bole Medhanialem',
    city: 'Addis Ababa',
    rating: 4.3,
    reviewCount: 156,
    totalOrders: 320,
    totalSales: 680000,
    isVerified: false,
  },
  {
    phone: '+251911456789',
    password: 'provider123',
    fullName: 'Dawit Haile',
    businessName: 'Bishoftu Electronics',
    email: 'dawit@bishoftu.shop',
    description: 'Specialized in electronics and gadgets',
    address: 'Bishoftu Main Street',
    city: 'Bishoftu',
    rating: 4.6,
    reviewCount: 89,
    totalOrders: 180,
    totalSales: 890000,
    isVerified: true,
  },
  {
    phone: '+251911567890',
    password: 'provider123',
    fullName: 'Salem Abdi',
    businessName: 'Ethio Fashion Hub',
    email: 'salem@ethiofashion.shop',
    description: 'Premium Ethiopian traditional and modern fashion',
    address: 'Kazanchis, Behind Ethio Mall',
    city: 'Addis Ababa',
    rating: 4.7,
    reviewCount: 201,
    totalOrders: 520,
    totalSales: 1850000,
    isVerified: true,
  },
];

const categories = [
  { id: 'fashion', nameEn: 'Fashion', nameAm: 'Fashion', nameOm: 'Fashion', slug: 'fashion', icon: 'checkroom_rounded', color: '#9A4D22' },
  { id: 'electronics', nameEn: 'Electronics', nameAm: 'Electronics', nameOm: 'Electronics', slug: 'electronics', icon: 'devices_rounded', color: '#00897B' },
  { id: 'shoes', nameEn: 'Shoes', nameAm: 'Shoes', nameOm: 'Shoes', slug: 'shoes', icon: 'workspaces_rounded', color: '#E67E22' },
  { id: 'food-drink', nameEn: 'Food & Drink', nameAm: 'Food & Drink', nameOm: 'Food & Drink', slug: 'food-drink', icon: 'restaurant_rounded', color: '#795548' },
  { id: 'phones', nameEn: 'Phones', nameAm: 'Phones', nameOm: 'Phones', slug: 'phones', icon: 'smartphone_rounded', color: '#1B9B5A' },
  { id: 'watches', nameEn: 'Watches', nameAm: 'Watches', nameOm: 'Watches', slug: 'watches', icon: 'watch_rounded', color: '#D4AC0D' },
  { id: 'home-living', nameEn: 'Home & Living', nameAm: 'Home & Living', nameOm: 'Home & Living', slug: 'home-living', icon: 'weekend_rounded', color: '#2E7D32' },
];

const brands = [
  { name: 'Nike', logoUrl: 'https://logo.clearbit.com/nike.com' },
  { name: 'Samsung', logoUrl: 'https://logo.clearbit.com/samsung.com' },
  { name: 'Apple', logoUrl: 'https://logo.clearbit.com/apple.com' },
  { name: 'Adidas', logoUrl: 'https://logo.clearbit.com/adidas.com' },
  { name: 'Sony', logoUrl: 'https://logo.clearbit.com/sony.com' },
];

const products = [
  {
    nameEn: 'Men\'s Running Shoes',
    nameAm: 'Men Running Shoes',
    nameOm: 'Men Running Shoes',
    descriptionEn: 'Comfortable running shoes with breathable mesh upper and cushioned sole for maximum comfort during workouts.',
    descriptionAm: 'Comfortable running shoes with breathable mesh upper and cushioned sole for maximum comfort during workouts.',
    descriptionOm: 'Comfortable running shoes with breathable mesh upper and cushioned sole for maximum comfort during workouts.',
    category: 'shoes',
    brand: 'Nike',
    priceCents: 250000,
    discountCents: 20000,
    stock: 50,
    sku: 'NKE-RUN-001',
    deliveryInfo: 'Free delivery within Addis Ababa',
    ratingAvg: 4.5,
    ratingCount: 45,
    soldCount: 120,
    specs: [
      { key: 'Material', value: 'Synthetic mesh' },
      { key: 'Sole', value: 'Rubber' },
      { key: 'Weight', value: '280g' },
      { key: 'Sizes', value: '40-45' },
    ],
    images: [
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500',
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=500',
      'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=500',
    ],
  },
  {
    nameEn: 'Wireless Bluetooth Headphones',
    nameAm: 'Wireless Bluetooth Headphones',
    nameOm: 'Wireless Bluetooth Headphones',
    descriptionEn: 'High-quality wireless headphones with noise cancellation and 30-hour battery life.',
    descriptionAm: 'High-quality wireless headphones with noise cancellation and 30-hour battery life.',
    descriptionOm: 'High-quality wireless headphones with noise cancellation and 30-hour battery life.',
    category: 'electronics',
    brand: 'Sony',
    priceCents: 450000,
    discountCents: 50000,
    stock: 30,
    sku: 'SNY-BTH-001',
    deliveryInfo: '2-3 business days',
    ratingAvg: 4.7,
    ratingCount: 89,
    soldCount: 85,
    specs: [
      { key: 'Battery', value: '30 hours' },
      { key: 'Connectivity', value: 'Bluetooth 5.0' },
      { key: 'Weight', value: '250g' },
      { key: 'Noise Cancellation', value: 'Active' },
    ],
    images: [
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
      'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=500',
    ],
  },
  {
    nameEn: 'Women\'s Summer Dress',
    nameAm: 'Women Summer Dress',
    nameOm: 'Women Summer Dress',
    descriptionEn: 'Elegant summer dress made from lightweight cotton fabric, perfect for casual outings.',
    descriptionAm: 'Elegant summer dress made from lightweight cotton fabric, perfect for casual outings.',
    descriptionOm: 'Elegant summer dress made from lightweight cotton fabric, perfect for casual outings.',
    category: 'fashion',
    brand: 'Adidas',
    priceCents: 180000,
    discountCents: 15000,
    stock: 40,
    sku: 'ADS-DRS-001',
    deliveryInfo: 'Express delivery available',
    ratingAvg: 4.6,
    ratingCount: 67,
    soldCount: 95,
    specs: [
      { key: 'Material', value: '100% Cotton' },
      { key: 'Sizes', value: 'XS, S, M, L, XL' },
      { key: 'Care', value: 'Machine washable' },
    ],
    images: [
      'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=500',
      'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=500',
    ],
  },
  {
    nameEn: 'Smartphone 64GB',
    nameAm: 'Smartphone 64GB',
    nameOm: 'Smartphone 64GB',
    descriptionEn: 'Latest smartphone with 64GB storage, 6GB RAM, and 48MP camera.',
    descriptionAm: 'Latest smartphone with 64GB storage, 6GB RAM, and 48MP camera.',
    descriptionOm: 'Latest smartphone with 64GB storage, 6GB RAM, and 48MP camera.',
    category: 'phones',
    brand: 'Samsung',
    priceCents: 850000,
    discountCents: 100000,
    stock: 25,
    sku: 'SAM-PHN-001',
    deliveryInfo: 'Same day delivery in Addis',
    ratingAvg: 4.8,
    ratingCount: 156,
    soldCount: 220,
    specs: [
      { key: 'Storage', value: '64GB' },
      { key: 'RAM', value: '6GB' },
      { key: 'Camera', value: '48MP' },
      { key: 'Battery', value: '4000mAh' },
    ],
    images: [
      'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500',
      'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=500',
    ],
  },
  {
    nameEn: 'Digital Watch',
    nameAm: 'Digital Watch',
    nameOm: 'Digital Watch',
    descriptionEn: 'Modern digital watch with fitness tracking, heart rate monitor, and water resistance.',
    descriptionAm: 'Modern digital watch with fitness tracking, heart rate monitor, and water resistance.',
    descriptionOm: 'Modern digital watch with fitness tracking, heart rate monitor, and water resistance.',
    category: 'watches',
    brand: 'Apple',
    priceCents: 1200000,
    discountCents: 150000,
    stock: 20,
    sku: 'APL-WTC-001',
    deliveryInfo: 'Free shipping nationwide',
    ratingAvg: 4.9,
    ratingCount: 234,
    soldCount: 310,
    specs: [
      { key: 'Display', value: 'AMOLED' },
      { key: 'Battery', value: '7 days' },
      { key: 'Water Resistance', value: '50m' },
      { key: 'Features', value: 'Heart rate, GPS' },
    ],
    images: [
      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
      'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=500',
    ],
  },
  {
    nameEn: 'Coffee Maker',
    nameAm: 'Coffee Maker',
    nameOm: 'Coffee Maker',
    descriptionEn: 'Automatic coffee maker with programmable timer and thermal carafe.',
    descriptionAm: 'Automatic coffee maker with programmable timer and thermal carafe.',
    descriptionOm: 'Automatic coffee maker with programmable timer and thermal carafe.',
    category: 'home-living',
    brand: 'Samsung',
    priceCents: 320000,
    discountCents: 30000,
    stock: 35,
    sku: 'SAM-COF-001',
    deliveryInfo: 'Available for pickup',
    ratingAvg: 4.4,
    ratingCount: 78,
    soldCount: 145,
    specs: [
      { key: 'Capacity', value: '12 cups' },
      { key: 'Power', value: '1000W' },
      { key: 'Features', value: 'Programmable timer' },
    ],
    images: [
      'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=500',
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=500',
    ],
  },
  {
    nameEn: 'Ethiopian Traditional Dress',
    nameAm: 'Ethiopian Traditional Dress',
    nameOm: 'Ethiopian Traditional Dress',
    descriptionEn: 'Beautiful traditional Ethiopian dress made from high-quality cotton with intricate embroidery.',
    descriptionAm: 'Beautiful traditional Ethiopian dress made from high-quality cotton with intricate embroidery.',
    descriptionOm: 'Beautiful traditional Ethiopian dress made from high-quality cotton with intricate embroidery.',
    category: 'fashion',
    brand: 'Nike',
    priceCents: 350000,
    discountCents: 50000,
    stock: 15,
    sku: 'NKE-TRD-001',
    deliveryInfo: 'Handmade in Ethiopia',
    ratingAvg: 4.9,
    ratingCount: 112,
    soldCount: 180,
    specs: [
      { key: 'Material', value: '100% Cotton' },
      { key: 'Handmade', value: 'Yes' },
      { key: 'Sizes', value: 'S, M, L, XL' },
    ],
    images: [
      'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=500',
      'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=500',
    ],
  },
];

async function seed() {
  console.log('Starting database seeding...');

  try {
    await pool.query('BEGIN');

    // Insert categories
    console.log('Inserting categories...');
    for (const cat of categories) {
      await pool.query(
        `INSERT INTO categories (id, name_en, name_am, name_om, slug, icon, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [cat.id, cat.nameEn, cat.nameAm, cat.nameOm, cat.slug, cat.icon, cat.color],
      );
    }

    // Insert brands
    console.log('Inserting brands...');
    for (const brand of brands) {
      await pool.query(
        `INSERT INTO brands (name, logo_url)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [brand.name, brand.logoUrl],
      );
    }

    // Get category and brand IDs
    const { rows: catRows } = await pool.query('SELECT id, slug FROM categories');
    const categoryMap = Object.fromEntries(catRows.map(r => [r.slug, r.id]));

    const { rows: brandRows } = await pool.query('SELECT id, name FROM brands');
    const brandMap = Object.fromEntries(brandRows.map(r => [r.name, r.id]));

    // Insert providers (users + partner profiles)
    console.log('Inserting providers...');
    const providerIds = [];
    for (const provider of providers) {
      // Check if user already exists
      const { rows: existingUsers } = await pool.query(
        'SELECT id FROM users WHERE phone = $1',
        [provider.phone],
      );
      
      let userId;
      if (existingUsers.length > 0) {
        userId = existingUsers[0].id;
        console.log(`  Provider ${provider.businessName} already exists, skipping user creation`);
      } else {
        const passwordHash = await bcrypt.hash(provider.password, 12);
        
        const { rows: userRows } = await pool.query(
          `INSERT INTO users (phone, password_hash, password_plain, role, is_active)
           VALUES ($1, $2, $3, 'PARTNER', true)
           RETURNING id`,
          [provider.phone, passwordHash, provider.password],
        );
        userId = userRows[0].id;
      }
      providerIds.push(userId);

      // Check if partner profile exists
      const { rows: existingProfiles } = await pool.query(
        'SELECT id FROM partner_profile WHERE user_id = $1',
        [userId],
      );
      
      if (existingProfiles.length === 0) {
        await pool.query(
          `INSERT INTO partner_profile (user_id, owner_name, business_name, phone, email, description, address, city, rating_avg, rating_count, total_orders, total_sales, is_verified, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)`,
          [userId, provider.fullName, provider.businessName, provider.phone, provider.email, provider.description, provider.address, provider.city, provider.rating, provider.reviewCount, provider.totalOrders, provider.totalSales, provider.isVerified],
        );
      } else {
        console.log(`  Partner profile for ${provider.businessName} already exists, skipping`);
      }
    }

    // Insert products for each provider
    console.log('Inserting products...');
    for (let p = 0; p < providerIds.length; p++) {
      const partnerId = providerIds[p];
      
      for (let i = 0; i < products.length; i++) {
        const prod = products[i];
        const categoryId = categoryMap[prod.category];
        const brandId = brandMap[prod.brand];

        const { rows: prodRows } = await pool.query(
          `INSERT INTO products 
           (partner_id, category, brand_id, name_en, name_am, name_om, 
            description_en, description_am, description_om, delivery_info,
            price_cents, discount_cents, sku, stock, rating_avg, rating_count, sold_count, status, is_visible)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'ACTIVE', true)
           RETURNING id`,
          [
            partnerId, categoryId, brandId,
            prod.nameEn, prod.nameAm, prod.nameOm,
            prod.descriptionEn, prod.descriptionAm, prod.descriptionOm,
            prod.deliveryInfo,
            prod.priceCents, prod.discountCents, prod.sku, prod.stock,
            prod.ratingAvg, prod.ratingCount, prod.soldCount,
          ],
        );
        const productId = prodRows[0].id;

        // Insert images
        for (let imgIdx = 0; imgIdx < prod.images.length; imgIdx++) {
          await pool.query(
            `INSERT INTO product_images (product_id, image_url, is_primary, sort_order)
             VALUES ($1, $2, $3, $4)`,
            [productId, prod.images[imgIdx], imgIdx === 0, imgIdx],
          );
        }

        // Insert specifications
        for (const spec of prod.specs) {
          await pool.query(
            `INSERT INTO product_specifications (product_id, spec_key, spec_value, display_order)
             VALUES ($1, $2, $3, $4)`,
            [productId, spec.key, spec.value, prod.specs.indexOf(spec)],
          );
        }

        // Add seller offers from other providers
        const otherProviders = providerIds.filter(id => id !== partnerId);
        for (let sp = 0; sp < Math.min(2, otherProviders.length); sp++) {
          const sellerId = otherProviders[sp];
          const sellerData = providers[providerIds.indexOf(sellerId)];
          const priceVariation = prod.priceCents * (0.9 + Math.random() * 0.2);
          
          await pool.query(
            `INSERT INTO seller_offers (product_id, seller_id, seller_name, price, rating, review_count, badge, badge_color, delivery_info, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
            [
              productId, sellerId, sellerData.businessName,
              Math.round(priceVariation),
              sellerData.rating,
              sellerData.reviewCount,
              sp === 0 ? 'Cheapest' : 'Nearby',
              sp === 0 ? '#27AE60' : '#2980B9',
              sp === 0 ? 'Free delivery' : 'Pickup available',
            ],
          );
        }

        // Add sample reviews
        const sampleReviews = [
          { rating: 5, comment: 'Excellent product! Very satisfied with the quality.' },
          { rating: 4, comment: 'Good value for money. Delivery was fast.' },
          { rating: 5, comment: 'Exactly as described. Will buy again!' },
        ];
        
        for (const review of sampleReviews) {
          await pool.query(
            `INSERT INTO product_reviews (product_id, customer_id, rating, comment, is_approved)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (product_id, customer_id) DO NOTHING`,
            [productId, providerIds[(p + i) % providerIds.length], review.rating, review.comment],
          );
        }
      }
    }

    await pool.query('COMMIT');
    console.log('\n✅ Database seeding completed successfully!');
    console.log(`✓ ${providers.length} providers created`);
    console.log(`✓ ${categories.length} categories created`);
    console.log(`✓ ${brands.length} brands created`);
    console.log(`✓ ${providers.length * products.length} products created`);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Seeding failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
