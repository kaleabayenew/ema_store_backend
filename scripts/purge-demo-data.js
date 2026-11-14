/**
 * Purge seeded DEMO data from the database.
 *
 * Targets only rows that the seed script (scripts/seed-database.js) created,
 * identified by clear demo markers (specific partner phones, Unsplash image
 * URLs, seed flash-deal titles). Real customers and orders are NOT touched
 * unless you pass --wipe-customers-orders (still requires --apply).
 *
 * Usage:
 *   node scripts/purge-demo-data.js            # dry run — counts only, deletes nothing
 *   node scripts/purge-demo-data.js --apply    # actually delete demo partners/products/flash deals
 *   node scripts/purge-demo-data.js --apply --wipe-customers-orders
 *
 * Reuses the app's existing DB config (env-driven) — no hardcoded credentials.
 */
const { pool } = require('../src/core/config/database');

const DRY = !process.argv.includes('--apply');
const WIPE_CUSTOMERS_ORDERS = process.argv.includes('--wipe-customers-orders');

// ── Demo markers from the seed script ─────────────────────────────────────────
const DEMO_PARTNER_PHONES = [
  '+251911123456', '+251911234567', '+251911345678', '+251911456789', '+251911567890',
];
const DEMO_FLASH_TITLES = ['50% Off Fashion Week', 'Electronics Bonanza', 'Weekend Special'];

async function count(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return parseInt(rows[0].count ?? 0);
}

async function exec(sql, params = []) {
  return pool.query(sql, params);
}

async function run() {
  console.log(DRY ? '\n=== DRY RUN (nothing will be deleted) ===\n' : '\n=== APPLYING DELETIONS ===\n');

  // Resolve demo partner user ids
  const { rows: demoPartners } = await pool.query(
    `SELECT id FROM users WHERE phone = ANY($1::text[]) AND role = 'PARTNER'`,
    [DEMO_PARTNER_PHONES],
  );
  const partnerIds = demoPartners.map((r) => r.id);
  console.log(`Demo partners matched: ${partnerIds.length}`);

  // Demo products: created by those demo partners OR with Unsplash images
  let demoProductSql = `SELECT DISTINCT p.id FROM products p
    LEFT JOIN product_images pi ON pi.product_id = p.id
    WHERE (p.partner_id = ANY($1::uuid[]))
       OR pi.image_url ILIKE '%images.unsplash.com%'`;
  // If no demo partners, only use the Unsplash marker
  const productParams = partnerIds.length ? [partnerIds] : [[]];
  if (!partnerIds.length) {
    demoProductSql = `SELECT DISTINCT p.id FROM products p
      LEFT JOIN product_images pi ON pi.product_id = p.id
      WHERE pi.image_url ILIKE '%images.unsplash.com%'`;
  }
  const { rows: demoProducts } = await pool.query(demoProductSql, productParams);
  const productIds = demoProducts.map((r) => r.id);
  console.log(`Demo products matched: ${productIds.length}`);

  // Demo flash deals
  const { rows: demoDeals } = await pool.query(
    `SELECT id FROM flash_deals WHERE title = ANY($1::text[]) OR image_url ILIKE '%images.unsplash.com%'`,
    [DEMO_FLASH_TITLES],
  );
  const dealIds = demoDeals.map((r) => r.id);
  console.log(`Demo flash deals matched: ${dealIds.length}`);

  // Dependent counts for transparency
  const depReviews    = productIds.length ? await count(`SELECT COUNT(*) FROM product_reviews WHERE product_id = ANY($1::uuid[])`, [productIds]) : 0;
  const depOffers     = productIds.length ? await count(`SELECT COUNT(*) FROM seller_offers WHERE product_id = ANY($1::uuid[])`, [productIds]) : 0;
  const depImages     = productIds.length ? await count(`SELECT COUNT(*) FROM product_images WHERE product_id = ANY($1::uuid[])`, [productIds]) : 0;
  const depSpecs      = productIds.length ? await count(`SELECT COUNT(*) FROM product_specifications WHERE product_id = ANY($1::uuid[])`, [productIds]) : 0;
  const depSellerOff  = partnerIds.length ? await count(`SELECT COUNT(*) FROM seller_offers WHERE seller_id = ANY($1::uuid[])`, [partnerIds]) : 0;
  const depProfiles   = partnerIds.length ? await count(`SELECT COUNT(*) FROM partner_profile WHERE user_id = ANY($1::uuid[])`, [partnerIds]) : 0;

  console.log(`  → product_reviews to remove: ${depReviews}`);
  console.log(`  → seller_offers (by product): ${depOffers}`);
  console.log(`  → product_images: ${depImages}`);
  console.log(`  → product_specifications: ${depSpecs}`);
  console.log(`  → seller_offers (by seller): ${depSellerOff}`);
  console.log(`  → partner_profile rows: ${depProfiles}`);

  if (WIPE_CUSTOMERS_ORDERS) {
    const cCount = await count(`SELECT COUNT(*) FROM users WHERE role = 'CUSTOMER'`);
    const oCount = await count(`SELECT COUNT(*) FROM orders`);
    console.log(`\n[!] --wipe-customers-orders is ON`);
    console.log(`  → customer users: ${cCount}`);
    console.log(`  → orders: ${oCount}`);
  }

  if (DRY) {
    console.log('\nDry run complete. Re-run with --apply to actually delete the demo rows above.');
    return;
  }

  // ── Apply deletions (children first) ────────────────────────────────────────
  if (productIds.length) {
    await exec(`DELETE FROM product_reviews WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await exec(`DELETE FROM seller_offers WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await exec(`DELETE FROM product_images WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await exec(`DELETE FROM product_specifications WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await exec(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [productIds]);
    console.log('✓ Demo products + dependents deleted');
  }

  if (dealIds.length) {
    await exec(`DELETE FROM flash_deal_categories WHERE flash_deal_id = ANY($1::uuid[])`, [dealIds]);
    await exec(`DELETE FROM flash_deals WHERE id = ANY($1::uuid[])`, [dealIds]);
    console.log('✓ Demo flash deals deleted');
  }

  if (partnerIds.length) {
    await exec(`DELETE FROM seller_offers WHERE seller_id = ANY($1::uuid[])`, [partnerIds]);
    await exec(`DELETE FROM partner_profile WHERE user_id = ANY($1::uuid[])`, [partnerIds]);
    await exec(`DELETE FROM users WHERE id = ANY($1::uuid[]) AND role = 'PARTNER'`, [partnerIds]);
    console.log('✓ Demo partners + profiles deleted');
  }

  if (WIPE_CUSTOMERS_ORDERS) {
    await exec(`DELETE FROM order_items`);
    await exec(`DELETE FROM orders`);
    await exec(`DELETE FROM users WHERE role = 'CUSTOMER'`);
    console.log('✓ All customers and orders deleted');
  }

  console.log('\n✅ Done.');
}

run()
  .catch((e) => { console.error('Purge failed:', e.message); console.error(e); process.exit(1); })
  .finally(() => pool.end());
