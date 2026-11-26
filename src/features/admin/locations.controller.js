const { pool } = require('../../core/config/database');
const { ok } = require('../../core/utils/response');
const {
  cleanCoord,
  ensureOrderFlowSchema,
  parseAddressPin,
} = require('../orders/order_flow');

async function getLocationMap(req, res, next) {
  try {
    await ensureOrderFlowSchema();

    const [partnerResult, customerResult] = await Promise.all([
      pool.query(
        `SELECT pp.user_id::text AS id,
                COALESCE(NULLIF(BTRIM(pp.business_name), ''),
                         NULLIF(BTRIM(pp.shop_name), ''),
                         'Partner') AS name,
                pp.city,
                pp.shop_lat AS lat,
                pp.shop_lng AS lng,
                pp.is_verified,
                pp.is_active
           FROM partner_profile pp
          WHERE pp.shop_lat BETWEEN -90 AND 90
            AND pp.shop_lng BETWEEN -180 AND 180
          ORDER BY name`,
      ),
      pool.query(
        `SELECT DISTINCT ON (o.user_id)
                o.user_id::text AS id,
                COALESCE(NULLIF(BTRIM(cu.full_name), ''),
                         NULLIF(BTRIM(u.full_name), ''),
                         'Customer') AS name,
                o.shipping_address,
                o.dropoff_lat AS lat,
                o.dropoff_lng AS lng,
                o.created_at
           FROM orders o
           JOIN users u ON u.id = o.user_id
           LEFT JOIN customer_user cu ON cu.user_id = o.user_id
          WHERE u.role = 'CUSTOMER'
            AND (
              (o.dropoff_lat BETWEEN -90 AND 90 AND o.dropoff_lng BETWEEN -180 AND 180)
              OR COALESCE(o.shipping_address, '') ~*
                 'Pin:[[:space:]]*-?[0-9]+([.][0-9]+)?[[:space:]]*,[[:space:]]*-?[0-9]+([.][0-9]+)?'
            )
          ORDER BY o.user_id, o.created_at DESC NULLS LAST`,
      ),
    ]);

    const partners = partnerResult.rows.map((row) => ({
      id: `partner:${row.id}`,
      kind: 'partner',
      name: row.name,
      detail: row.city || 'Shop location',
      lat: Number(row.lat),
      lng: Number(row.lng),
      active: row.is_active !== false,
      verified: row.is_verified === true,
    }));

    const customers = customerResult.rows.flatMap((row) => {
      const storedLat = cleanCoord(row.lat, 90);
      const storedLng = cleanCoord(row.lng, 180);
      const parsed = storedLat !== null && storedLng !== null
        ? { lat: storedLat, lng: storedLng }
        : parseAddressPin(row.shipping_address);
      if (parsed.lat === null || parsed.lng === null) return [];
      return [{
        id: `customer:${row.id}`,
        kind: 'customer',
        name: row.name,
        detail: 'Latest pinned delivery',
        lat: parsed.lat,
        lng: parsed.lng,
        updatedAt: row.created_at,
      }];
    });

    const locations = [...partners, ...customers];
    ok(res, {
      locations,
      counts: {
        partners: partners.length,
        customers: customers.length,
        total: locations.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getLocationMap };
