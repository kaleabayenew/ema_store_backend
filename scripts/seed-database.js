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

// Unique products for each provider - 7 different products per provider
const allProducts = [
  // Provider 1 (Addis Prime Shop) - Electronics & Fashion
  [
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
  ],
  // Provider 2 (Merkato Central) - Home & Food
  [
    {
      nameEn: 'Blender',
      nameAm: 'Blender',
      nameOm: 'Blender',
      descriptionEn: 'High-speed blender for smoothies, soups, and food preparation.',
      descriptionAm: 'High-speed blender for smoothies, soups, and food preparation.',
      descriptionOm: 'High-speed blender for smoothies, soups, and food preparation.',
      category: 'home-living',
      brand: 'Samsung',
      priceCents: 280000,
      discountCents: 25000,
      stock: 45,
      sku: 'SAM-BLN-001',
      deliveryInfo: 'Available for pickup',
      ratingAvg: 4.3,
      ratingCount: 56,
      soldCount: 89,
      specs: [
        { key: 'Power', value: '800W' },
        { key: 'Capacity', value: '1.5L' },
        { key: 'Speeds', value: '5' },
      ],
      images: [
        'https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=500',
        'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=500',
      ],
    },
    {
      nameEn: 'Electric Kettle',
      nameAm: 'Electric Kettle',
      nameOm: 'Electric Kettle',
      descriptionEn: 'Fast boiling electric kettle with temperature control.',
      descriptionAm: 'Fast boiling electric kettle with temperature control.',
      descriptionOm: 'Fast boiling electric kettle with temperature control.',
      category: 'home-living',
      brand: 'Sony',
      priceCents: 150000,
      discountCents: 10000,
      stock: 60,
      sku: 'SNY-KTL-001',
      deliveryInfo: '2-3 business days',
      ratingAvg: 4.5,
      ratingCount: 78,
      soldCount: 134,
      specs: [
        { key: 'Capacity', value: '1.7L' },
        { key: 'Power', value: '2200W' },
        { key: 'Material', value: 'Stainless Steel' },
      ],
      images: [
        'https://images.unsplash.com/photo-1594213114663-d94db9b66d60?w=500',
        'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=500',
      ],
    },
    {
      nameEn: 'Ethiopian Coffee',
      nameAm: 'Ethiopian Coffee',
      nameOm: 'Ethiopian Coffee',
      descriptionEn: 'Premium Ethiopian Yirgacheffe coffee beans, 500g pack.',
      descriptionAm: 'Premium Ethiopian Yirgacheffe coffee beans, 500g pack.',
      descriptionOm: 'Premium Ethiopian Yirgacheffe coffee beans, 500g pack.',
      category: 'food-drink',
      brand: 'Nike',
      priceCents: 45000,
      discountCents: 5000,
      stock: 100,
      sku: 'NKE-COF-001',
      deliveryInfo: 'Same day delivery',
      ratingAvg: 4.8,
      ratingCount: 245,
      soldCount: 567,
      specs: [
        { key: 'Origin', value: 'Yirgacheffe' },
        { key: 'Weight', value: '500g' },
        { key: 'Roast', value: 'Medium' },
      ],
      images: [
        'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=500',
        'https://images.unsplash.com/photo-1610632380989-680fe40816c6?w=500',
      ],
    },
    {
      nameEn: 'Traditional Shemma',
      nameAm: 'Traditional Shemma',
      nameOm: 'Traditional Shemma',
      descriptionEn: 'Authentic Ethiopian cotton shemma for traditional clothing.',
      descriptionAm: 'Authentic Ethiopian cotton shemma for traditional clothing.',
      descriptionOm: 'Authentic Ethiopian cotton shemma for traditional clothing.',
      category: 'fashion',
      brand: 'Adidas',
      priceCents: 280000,
      discountCents: 20000,
      stock: 25,
      sku: 'ADS-SHM-001',
      deliveryInfo: 'Express delivery',
      ratingAvg: 4.7,
      ratingCount: 89,
      soldCount: 156,
      specs: [
        { key: 'Material', value: '100% Cotton' },
        { key: 'Size', value: '2m x 1m' },
        { key: 'Colors', value: 'White with borders' },
      ],
      images: [
        'https://images.unsplash.com/photo-1503341455253-b2e7234db71f?w=500',
        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=500',
      ],
    },
    {
      nameEn: 'Tennis Shoes',
      nameAm: 'Tennis Shoes',
      nameOm: 'Tennis Shoes',
      descriptionEn: 'Lightweight tennis shoes for sports and casual wear.',
      descriptionAm: 'Lightweight tennis shoes for sports and casual wear.',
      descriptionOm: 'Lightweight tennis shoes for sports and casual wear.',
      category: 'shoes',
      brand: 'Nike',
      priceCents: 220000,
      discountCents: 15000,
      stock: 40,
      sku: 'NKE-TNS-001',
      deliveryInfo: 'Free delivery',
      ratingAvg: 4.4,
      ratingCount: 67,
      soldCount: 98,
      specs: [
        { key: 'Upper', value: 'Synthetic' },
        { key: 'Sole', value: 'Rubber' },
        { key: 'Weight', value: '260g' },
      ],
      images: [
        'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=500',
        'https://images.unsplash.com/photo-1491553895911-0055uj4b0b5?w=500',
      ],
    },
    {
      nameEn: 'Kitchen Knife Set',
      nameAm: 'Kitchen Knife Set',
      nameOm: 'Kitchen Knife Set',
      descriptionEn: 'Professional 6-piece kitchen knife set with wooden block.',
      descriptionAm: 'Professional 6-piece kitchen knife set with wooden block.',
      descriptionOm: 'Professional 6-piece kitchen knife set with wooden block.',
      category: 'home-living',
      brand: 'Samsung',
      priceCents: 180000,
      discountCents: 12000,
      stock: 30,
      sku: 'SAM-KNF-001',
      deliveryInfo: 'Pickup available',
      ratingAvg: 4.6,
      ratingCount: 45,
      soldCount: 78,
      specs: [
        { key: 'Pieces', value: '6' },
        { key: 'Material', value: 'Stainless Steel' },
        { key: 'Block', value: 'Wooden' },
      ],
      images: [
        'https://images.unsplash.com/photo-1593618998160-e34014e67546?w=500',
        'https://images.unsplash.com/photo-1584990347449-a2d4e2b29c25?w=500',
      ],
    },
    {
      nameEn: 'Honey (1kg)',
      nameAm: 'Honey (1kg)',
      nameOm: 'Honey (1kg)',
      descriptionEn: 'Pure Ethiopian white honey from Wollo region.',
      descriptionAm: 'Pure Ethiopian white honey from Wollo region.',
      descriptionOm: 'Pure Ethiopian white honey from Wollo region.',
      category: 'food-drink',
      brand: 'Sony',
      priceCents: 65000,
      discountCents: 5000,
      stock: 80,
      sku: 'SNY-HNY-001',
      deliveryInfo: 'Nationwide delivery',
      ratingAvg: 4.9,
      ratingCount: 178,
      soldCount: 345,
      specs: [
        { key: 'Weight', value: '1kg' },
        { key: 'Origin', value: 'Wollo' },
        { key: 'Type', value: 'White Honey' },
      ],
      images: [
        'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=500',
        'https://images.unsplash.com/photo-1621871402211-34596a806f0a?w=500',
      ],
    },
  ],
  // Provider 3 (Bole Market) - Fashion & Accessories
  [
    {
      nameEn: 'Women\'s Handbag',
      nameAm: 'Women Handbag',
      nameOm: 'Women Handbag',
      descriptionEn: 'Stylish leather handbag with multiple compartments.',
      descriptionAm: 'Stylish leather handbag with multiple compartments.',
      descriptionOm: 'Stylish leather handbag with multiple compartments.',
      category: 'fashion',
      brand: 'Adidas',
      priceCents: 450000,
      discountCents: 40000,
      stock: 35,
      sku: 'ADS-HNB-001',
      deliveryInfo: 'Express delivery',
      ratingAvg: 4.5,
      ratingCount: 89,
      soldCount: 134,
      specs: [
        { key: 'Material', value: 'Genuine Leather' },
        { key: 'Compartments', value: '5' },
        { key: 'Color', value: 'Brown' },
      ],
      images: [
        'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500',
        'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=500',
      ],
    },
    {
      nameEn: 'Men\'s Leather Belt',
      nameAm: 'Men Leather Belt',
      nameOm: 'Men Leather Belt',
      descriptionEn: 'Premium leather belt with metal buckle.',
      descriptionAm: 'Premium leather belt with metal buckle.',
      descriptionOm: 'Premium leather belt with metal buckle.',
      category: 'fashion',
      brand: 'Nike',
      priceCents: 35000,
      discountCents: 3000,
      stock: 70,
      sku: 'NKE-BLT-001',
      deliveryInfo: 'Same day delivery',
      ratingAvg: 4.3,
      ratingCount: 45,
      soldCount: 112,
      specs: [
        { key: 'Material', value: 'Genuine Leather' },
        { key: 'Width', value: '4cm' },
        { key: 'Sizes', value: 'S, M, L, XL' },
      ],
      images: [
        'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500',
        'https://images.unsplash.com/photo-1624222247344-550fb60583dc?w=500',
      ],
    },
    {
      nameEn: 'Sunglasses',
      nameAm: 'Sunglasses',
      nameOm: 'Sunglasses',
      descriptionEn: 'UV protection sunglasses with polarized lenses.',
      descriptionAm: 'UV protection sunglasses with polarized lenses.',
      descriptionOm: 'UV protection sunglasses with polarized lenses.',
      category: 'fashion',
      brand: 'Sony',
      priceCents: 120000,
      discountCents: 10000,
      stock: 50,
      sku: 'SNY-SGL-001',
      deliveryInfo: '2-3 business days',
      ratingAvg: 4.4,
      ratingCount: 67,
      soldCount: 89,
      specs: [
        { key: 'UV Protection', value: '100%' },
        { key: 'Lens', value: 'Polarized' },
        { key: 'Frame', value: 'Acetate' },
      ],
      images: [
        'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=500',
        'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=500',
      ],
    },
    {
      nameEn: 'Smart Watch',
      nameAm: 'Smart Watch',
      nameOm: 'Smart Watch',
      descriptionEn: 'Smart watch with fitness tracking and notifications.',
      descriptionAm: 'Smart watch with fitness tracking and notifications.',
      descriptionOm: 'Smart watch with fitness tracking and notifications.',
      category: 'watches',
      brand: 'Apple',
      priceCents: 950000,
      discountCents: 80000,
      stock: 25,
      sku: 'APL-SWT-001',
      deliveryInfo: 'Free shipping',
      ratingAvg: 4.7,
      ratingCount: 156,
      soldCount: 234,
      specs: [
        { key: 'Display', value: '1.4 inch AMOLED' },
        { key: 'Battery', value: '5 days' },
        { key: 'Water Resistance', value: '5ATM' },
      ],
      images: [
        'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=500',
        'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=500',
      ],
    },
    {
      nameEn: 'Jewelry Set',
      nameAm: 'Jewelry Set',
      nameOm: 'Jewelry Set',
      descriptionEn: 'Elegant gold-plated necklace and earring set.',
      descriptionAm: 'Elegant gold-plated necklace and earring set.',
      descriptionOm: 'Elegant gold-plated necklace and earring set.',
      category: 'fashion',
      brand: 'Samsung',
      priceCents: 380000,
      discountCents: 35000,
      stock: 20,
      sku: 'SAM-JWL-001',
      deliveryInfo: 'Express delivery',
      ratingAvg: 4.8,
      ratingCount: 78,
      soldCount: 145,
      specs: [
        { key: 'Material', value: 'Gold-plated' },
        { key: 'Pieces', value: '2' },
        { key: 'Style', value: 'Traditional' },
      ],
      images: [
        'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=500',
        'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=500',
      ],
    },
    {
      nameEn: 'Sneakers',
      nameAm: 'Sneakers',
      nameOm: 'Sneakers',
      descriptionEn: 'Casual sneakers for everyday wear.',
      descriptionAm: 'Casual sneakers for everyday wear.',
      descriptionOm: 'Casual sneakers for everyday wear.',
      category: 'shoes',
      brand: 'Nike',
      priceCents: 280000,
      discountCents: 20000,
      stock: 45,
      sku: 'NKE-SNK-001',
      deliveryInfo: 'Free delivery',
      ratingAvg: 4.5,
      ratingCount: 89,
      soldCount: 167,
      specs: [
        { key: 'Upper', value: 'Canvas' },
        { key: 'Sole', value: 'Rubber' },
        { key: 'Closure', value: 'Lace' },
      ],
      images: [
        'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=500',
        'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=500',
      ],
    },
    {
      nameEn: 'Scarf',
      nameAm: 'Scarf',
      nameOm: 'Scarf',
      descriptionEn: 'Soft cotton scarf with traditional Ethiopian patterns.',
      descriptionAm: 'Soft cotton scarf with traditional Ethiopian patterns.',
      descriptionOm: 'Soft cotton scarf with traditional Ethiopian patterns.',
      category: 'fashion',
      brand: 'Adidas',
      priceCents: 45000,
      discountCents: 4000,
      stock: 60,
      sku: 'ADS-SCF-001',
      deliveryInfo: 'Same day delivery',
      ratingAvg: 4.6,
      ratingCount: 56,
      soldCount: 123,
      specs: [
        { key: 'Material', value: '100% Cotton' },
        { key: 'Size', value: '180cm x 30cm' },
        { key: 'Pattern', value: 'Traditional' },
      ],
      images: [
        'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=500',
        'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=500',
      ],
    },
  ],
  // Provider 4 (Bishoftu Electronics) - Electronics & Phones
  [
    {
      nameEn: 'Laptop 15.6"',
      nameAm: 'Laptop 15.6',
      nameOm: 'Laptop 15.6',
      descriptionEn: 'Powerful laptop with 16GB RAM and 512GB SSD.',
      descriptionAm: 'Powerful laptop with 16GB RAM and 512GB SSD.',
      descriptionOm: 'Powerful laptop with 16GB RAM and 512GB SSD.',
      category: 'electronics',
      brand: 'Apple',
      priceCents: 2500000,
      discountCents: 200000,
      stock: 15,
      sku: 'APL-LPT-001',
      deliveryInfo: 'Free shipping',
      ratingAvg: 4.8,
      ratingCount: 89,
      soldCount: 145,
      specs: [
        { key: 'RAM', value: '16GB' },
        { key: 'Storage', value: '512GB SSD' },
        { key: 'Display', value: '15.6 inch' },
      ],
      images: [
        'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500',
        'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=500',
      ],
    },
    {
      nameEn: 'Wireless Earbuds',
      nameAm: 'Wireless Earbuds',
      nameOm: 'Wireless Earbuds',
      descriptionEn: 'True wireless earbuds with active noise cancellation.',
      descriptionAm: 'True wireless earbuds with active noise cancellation.',
      descriptionOm: 'True wireless earbuds with active noise cancellation.',
      category: 'electronics',
      brand: 'Sony',
      priceCents: 180000,
      discountCents: 15000,
      stock: 55,
      sku: 'SNY-ERB-001',
      deliveryInfo: '2-3 business days',
      ratingAvg: 4.6,
      ratingCount: 134,
      soldCount: 267,
      specs: [
        { key: 'Battery', value: '6 hours + 24 hours case' },
        { key: 'ANC', value: 'Active' },
        { key: 'Water Resistance', value: 'IPX4' },
      ],
      images: [
        'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500',
        'https://images.unsplash.com/photo-1572569028738-411a3a0c2cbe?w=500',
      ],
    },
    {
      nameEn: 'Smartphone 128GB',
      nameAm: 'Smartphone 128GB',
      nameOm: 'Smartphone 128GB',
      descriptionEn: 'Premium smartphone with 128GB storage and triple camera.',
      descriptionAm: 'Premium smartphone with 128GB storage and triple camera.',
      descriptionOm: 'Premium smartphone with 128GB storage and triple camera.',
      category: 'phones',
      brand: 'Samsung',
      priceCents: 1200000,
      discountCents: 120000,
      stock: 20,
      sku: 'SAM-PHN-002',
      deliveryInfo: 'Same day delivery',
      ratingAvg: 4.9,
      ratingCount: 178,
      soldCount: 289,
      specs: [
        { key: 'Storage', value: '128GB' },
        { key: 'RAM', value: '8GB' },
        { key: 'Camera', value: '108MP + 12MP + 8MP' },
      ],
      images: [
        'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=500',
        'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=500',
      ],
    },
    {
      nameEn: 'Tablet 10"',
      nameAm: 'Tablet 10',
      nameOm: 'Tablet 10',
      descriptionEn: '10-inch tablet perfect for work and entertainment.',
      descriptionAm: '10-inch tablet perfect for work and entertainment.',
      descriptionOm: '10-inch tablet perfect for work and entertainment.',
      category: 'electronics',
      brand: 'Apple',
      priceCents: 850000,
      discountCents: 70000,
      stock: 25,
      sku: 'APL-TBL-001',
      deliveryInfo: 'Free shipping',
      ratingAvg: 4.7,
      ratingCount: 89,
      soldCount: 156,
      specs: [
        { key: 'Display', value: '10 inch' },
        { key: 'Storage', value: '64GB' },
        { key: 'Battery', value: '10 hours' },
      ],
      images: [
        'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500',
        'https://images.unsplash.com/photo-1561154464-82e9adf32764?w=500',
      ],
    },
    {
      nameEn: 'Power Bank 20000mAh',
      nameAm: 'Power Bank 20000mAh',
      nameOm: 'Power Bank 20000mAh',
      descriptionEn: 'High capacity power bank with fast charging.',
      descriptionAm: 'High capacity power bank with fast charging.',
      descriptionOm: 'High capacity power bank with fast charging.',
      category: 'electronics',
      brand: 'Samsung',
      priceCents: 85000,
      discountCents: 7000,
      stock: 80,
      sku: 'SAM-PWB-001',
      deliveryInfo: '2-3 business days',
      ratingAvg: 4.4,
      ratingCount: 145,
      soldCount: 312,
      specs: [
        { key: 'Capacity', value: '20000mAh' },
        { key: 'Output', value: '18W Fast Charge' },
        { key: 'Ports', value: '2 USB + 1 Type-C' },
      ],
      images: [
        'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=500',
        'https://images.unsplash.com/photo-1559592527-8e883fa6c4dc?w=500',
      ],
    },
    {
      nameEn: 'Webcam HD',
      nameAm: 'Webcam HD',
      nameOm: 'Webcam HD',
      descriptionEn: '1080p HD webcam with built-in microphone.',
      descriptionAm: '1080p HD webcam with built-in microphone.',
      descriptionOm: '1080p HD webcam with built-in microphone.',
      category: 'electronics',
      brand: 'Sony',
      priceCents: 120000,
      discountCents: 10000,
      stock: 40,
      sku: 'SNY-WCM-001',
      deliveryInfo: 'Same day delivery',
      ratingAvg: 4.3,
      ratingCount: 56,
      soldCount: 89,
      specs: [
        { key: 'Resolution', value: '1080p' },
        { key: 'Microphone', value: 'Built-in' },
        { key: 'Mount', value: 'Clip-on' },
      ],
      images: [
        'https://images.unsplash.com/photo-1587826080692-f439cd0b70da?w=500',
        'https://images.unsplash.com/photo-1563770095-39d468f95c4d?w=500',
      ],
    },
    {
      nameEn: 'USB-C Hub',
      nameAm: 'USB-C Hub',
      nameOm: 'USB-C Hub',
      descriptionEn: '7-in-1 USB-C hub with HDMI, USB 3.0, and SD card reader.',
      descriptionAm: '7-in-1 USB-C hub with HDMI, USB 3.0, and SD card reader.',
      descriptionOm: '7-in-1 USB-C hub with HDMI, USB 3.0, and SD card reader.',
      category: 'electronics',
      brand: 'Samsung',
      priceCents: 65000,
      discountCents: 5000,
      stock: 60,
      sku: 'SAM-HUB-001',
      deliveryInfo: '2-3 business days',
      ratingAvg: 4.5,
      ratingCount: 78,
      soldCount: 145,
      specs: [
        { key: 'Ports', value: '7' },
        { key: 'HDMI', value: '4K@30Hz' },
        { key: 'USB', value: '3x USB 3.0' },
      ],
      images: [
        'https://images.unsplash.com/photo-1625948515291-696130d109d5?w=500',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=500',
      ],
    },
  ],
  // Provider 5 (Ethio Fashion Hub) - Fashion & Shoes
  [
    {
      nameEn: 'Women\'s Heels',
      nameAm: 'Women Heels',
      nameOm: 'Women Heels',
      descriptionEn: 'Elegant high heels for special occasions.',
      descriptionAm: 'Elegant high heels for special occasions.',
      descriptionOm: 'Elegant high heels for special occasions.',
      category: 'shoes',
      brand: 'Nike',
      priceCents: 320000,
      discountCents: 25000,
      stock: 30,
      sku: 'NKE-HLS-001',
      deliveryInfo: 'Express delivery',
      ratingAvg: 4.4,
      ratingCount: 56,
      soldCount: 89,
      specs: [
        { key: 'Heel Height', value: '10cm' },
        { key: 'Material', value: 'Synthetic' },
        { key: 'Sizes', value: '36-40' },
      ],
      images: [
        'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500',
        'https://images.unsplash.com/photo-1515347619252-60a6bf4fffce?w=500',
      ],
    },
    {
      nameEn: 'Men\'s Dress Shoes',
      nameAm: 'Men Dress Shoes',
      nameOm: 'Men Dress Shoes',
      descriptionEn: 'Classic leather dress shoes for formal occasions.',
      descriptionAm: 'Classic leather dress shoes for formal occasions.',
      descriptionOm: 'Classic leather dress shoes for formal occasions.',
      category: 'shoes',
      brand: 'Adidas',
      priceCents: 450000,
      discountCents: 35000,
      stock: 25,
      sku: 'ADS-DRS-002',
      deliveryInfo: 'Free delivery',
      ratingAvg: 4.6,
      ratingCount: 78,
      soldCount: 134,
      specs: [
        { key: 'Material', value: 'Genuine Leather' },
        { key: 'Style', value: 'Oxford' },
        { key: 'Sizes', value: '40-45' },
      ],
      images: [
        'https://images.unsplash.com/photo-1614252369475-531eba835eb1?w=500',
        'https://images.unsplash.com/photo-1449505278894-297fdb3edbc1?w=500',
      ],
    },
    {
      nameEn: 'Women\'s Handbag Premium',
      nameAm: 'Women Handbag Premium',
      nameOm: 'Women Handbag Premium',
      descriptionEn: 'Luxury designer handbag with gold hardware.',
      descriptionAm: 'Luxury designer handbag with gold hardware.',
      descriptionOm: 'Luxury designer handbag with gold hardware.',
      category: 'fashion',
      brand: 'Sony',
      priceCents: 780000,
      discountCents: 60000,
      stock: 15,
      sku: 'SNY-HNB-002',
      deliveryInfo: 'Express delivery',
      ratingAvg: 4.8,
      ratingCount: 45,
      soldCount: 78,
      specs: [
        { key: 'Material', value: 'Premium Leather' },
        { key: 'Hardware', value: 'Gold-plated' },
        { key: 'Compartments', value: '3' },
      ],
      images: [
        'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=500',
        'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500',
      ],
    },
    {
      nameEn: 'Traditional Jewelry Set',
      nameAm: 'Traditional Jewelry Set',
      nameOm: 'Traditional Jewelry Set',
      descriptionEn: 'Ethiopian gold jewelry set with necklace and earrings.',
      descriptionAm: 'Ethiopian gold jewelry set with necklace and earrings.',
      descriptionOm: 'Ethiopian gold jewelry set with necklace and earrings.',
      category: 'fashion',
      brand: 'Samsung',
      priceCents: 1250000,
      discountCents: 100000,
      stock: 10,
      sku: 'SAM-JWL-002',
      deliveryInfo: 'Insurance shipping',
      ratingAvg: 4.9,
      ratingCount: 34,
      soldCount: 56,
      specs: [
        { key: 'Material', value: '18K Gold' },
        { key: 'Pieces', value: '3' },
        { key: 'Origin', value: 'Ethiopian' },
      ],
      images: [
        'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=500',
        'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=500',
      ],
    },
    {
      nameEn: 'Women\'s Sandals',
      nameAm: 'Women Sandals',
      nameOm: 'Women Sandals',
      descriptionEn: 'Comfortable flat sandals for casual wear.',
      descriptionAm: 'Comfortable flat sandals for casual wear.',
      descriptionOm: 'Comfortable flat sandals for casual wear.',
      category: 'shoes',
      brand: 'Nike',
      priceCents: 180000,
      discountCents: 12000,
      stock: 50,
      sku: 'NKE-SND-001',
      deliveryInfo: 'Free delivery',
      ratingAvg: 4.3,
      ratingCount: 67,
      soldCount: 112,
      specs: [
        { key: 'Sole', value: 'Rubber' },
        { key: 'Upper', value: 'Leather' },
        { key: 'Sizes', value: '36-40' },
      ],
      images: [
        'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=500',
        'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=500',
      ],
    },
    {
      nameEn: 'Men\'s Wallet',
      nameAm: 'Men Wallet',
      nameOm: 'Men Wallet',
      descriptionEn: 'Slim leather wallet with RFID protection.',
      descriptionAm: 'Slim leather wallet with RFID protection.',
      descriptionOm: 'Slim leather wallet with RFID protection.',
      category: 'fashion',
      brand: 'Adidas',
      priceCents: 55000,
      discountCents: 4000,
      stock: 70,
      sku: 'ADS-WLT-001',
      deliveryInfo: 'Same day delivery',
      ratingAvg: 4.5,
      ratingCount: 89,
      soldCount: 178,
      specs: [
        { key: 'Material', value: 'Genuine Leather' },
        { key: 'RFID', value: 'Protected' },
        { key: 'Card Slots', value: '8' },
      ],
      images: [
        'https://images.unsplash.com/photo-1627123424574-724758594e93?w=500',
        'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500',
      ],
    },
    {
      nameEn: 'Ethiopian Dress Modern',
      nameAm: 'Ethiopian Dress Modern',
      nameOm: 'Ethiopian Dress Modern',
      descriptionEn: 'Modern Ethiopian dress with traditional embroidery.',
      descriptionAm: 'Modern Ethiopian dress with traditional embroidery.',
      descriptionOm: 'Modern Ethiopian dress with traditional embroidery.',
      category: 'fashion',
      brand: 'Sony',
      priceCents: 420000,
      discountCents: 35000,
      stock: 20,
      sku: 'SNY-DRS-002',
      deliveryInfo: 'Express delivery',
      ratingAvg: 4.7,
      ratingCount: 56,
      soldCount: 98,
      specs: [
        { key: 'Material', value: 'Cotton blend' },
        { key: 'Style', value: 'Modern-traditional' },
        { key: 'Sizes', value: 'S, M, L, XL' },
      ],
      images: [
        'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=500',
        'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=500',
      ],
    },
  ],
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

    // Insert unique products for each provider
    console.log('Inserting products...');
    for (let p = 0; p < providerIds.length; p++) {
      const partnerId = providerIds[p];
      const providerProducts = allProducts[p] || allProducts[0]; // Fallback to first provider's products
      
      for (let i = 0; i < providerProducts.length; i++) {
        const prod = providerProducts[i];
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

    // Seed flash deals
    console.log('\nSeeding flash deals...');
    
    // Ensure flash_deals table has the correct schema
    try {
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS title VARCHAR(255)`);
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS description TEXT`);
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS image_url TEXT`);
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id)`);
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
      await pool.query(`ALTER TABLE flash_deals DROP COLUMN IF EXISTS product_id`);
      await pool.query(`ALTER TABLE flash_deals DROP COLUMN IF EXISTS discount_percentage`);
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS discount_percent INTEGER`);
      await pool.query(`ALTER TABLE flash_deals DROP COLUMN IF EXISTS start_time`);
      await pool.query(`ALTER TABLE flash_deals DROP COLUMN IF EXISTS end_time`);
    } catch (e) {
      // Ignore errors, columns might already exist
    }

    const now = new Date();
    const flashDeals = [
      {
        title: '50% Off Fashion Week',
        description: 'Get 50% off on all fashion items from top Ethiopian designers!',
        discountPercent: 50,
        startsAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
        endsAt: new Date(now.getTime() + 22 * 60 * 60 * 1000), // 22 hours from now
        imageUrl: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=500',
        categoryIds: [categories[0].id], // Fashion
      },
      {
        title: 'Electronics Bonanza',
        description: 'Up to 30% off on smartphones, headphones, and accessories!',
        discountPercent: 30,
        startsAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
        endsAt: new Date(now.getTime() + 11 * 60 * 60 * 1000), // 11 hours from now
        imageUrl: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=500',
        categoryIds: [categories[1].id], // Electronics
      },
      {
        title: 'Weekend Special',
        description: 'Up to 40% off on shoes and accessories!',
        discountPercent: 40,
        startsAt: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3 hours ago
        endsAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500',
        categoryIds: [categories[2].id], // Shoes
      },
    ];

    for (const deal of flashDeals) {
      const { rows: dealRows } = await pool.query(
        `INSERT INTO flash_deals (title, description, discount_percent, starts_at, ends_at, image_url, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id`,
        [deal.title, deal.description, deal.discountPercent, deal.startsAt, deal.endsAt, deal.imageUrl],
      );

      const dealId = dealRows[0].id;

      // Link categories
      for (const categoryId of deal.categoryIds) {
        await pool.query(
          `INSERT INTO flash_deal_categories (flash_deal_id, category_id)
           VALUES ($1, $2::varchar)`,
          [dealId, categoryId],
        );
      }
    }
    console.log('✓ Flash deals seeded');

    await pool.query('COMMIT');
    console.log('\n✅ Database seeding completed successfully!');
    console.log(`✓ ${providers.length} providers created`);
    console.log(`✓ ${categories.length} categories created`);
    console.log(`✓ ${brands.length} brands created`);
    const totalProducts = allProducts.reduce((sum, products) => sum + products.length, 0);
    console.log(`✓ ${totalProducts} unique products created`);
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
