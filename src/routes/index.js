const { Router } = require('express');

// ── Customer / shared feature routers ────────────────────────────────────────
const authRouter = require('../features/auth/auth.router');
const notificationsRouter = require('../features/notifications/notifications.router');
const flashDealsRouter = require('../features/flash-deals/flash-deals.router');
const productsRouter = require('../features/products/products.router');
const uploadRouter = require('../features/upload/upload.router');
const telegramRouter = require('../features/telegram/telegram.routes');
const referralRouter = require('../features/referral/referral.routes');
const specialOffersRouter = require('../features/special-offers/special-offers.router');
const customersRouter = require('../features/customers/customers.router');
const adminPartnersRouter = require('../features/admin/partners.router');
const adminUsersRouter = require('../features/users/users.router');
const bidsRouter = require('../features/bids/bids.router');
const supportRouter = require('../features/support/support.router');
const bannersRouter = require('../features/banners/banners.router');
const cartRouter = require('../features/cart/cart.router');
const ordersRouter = require('../features/orders/orders.router');
const walletRouter = require('../features/wallet/wallet.router');
const paymentMethodsRouter = require('../features/payment-methods/payment-methods.router');
const auctionsRouter = require('../features/auctions/auctions.router');
const wishlistRouter = require('../features/wishlist/wishlist.router');
const reviewsRouter = require('../features/reviews/reviews.router');
const recentlyViewedRouter = require('../features/recently-viewed/recently_viewed.router');
const marketingRouter = require('../features/marketing/marketing.router');
const aboutRouter = require('../features/about/about.router');
const appUpdateRouter = require('../features/app-update/app-update.router');

// ── Partner feature routers ───────────────────────────────────────────────────
const partnerAuthRouter = require('../features/partner/auth/auth.router');
const partnerDashboardRouter = require('../features/partner/dashboard/dashboard.router');
const partnerProductsRouter = require('../features/partner/products/products.router');
const partnerOrdersRouter = require('../features/partner/orders/orders.router');
const partnerInventoryRouter = require('../features/partner/inventory/inventory.router');
const partnerEarningsRouter = require('../features/partner/earnings/earnings.router');
const partnerProfileRouter = require('../features/partner/profile/profile.router');
const partnerReviewsRouter = require('../features/partner/reviews/reviews.router');
const partnerPromotionsRouter = require('../features/partner/promotions/promotions.router');
const partnerSettingsRouter = require('../features/partner/settings/settings.router');

const router = Router();

// ── Customer auth ─────────────────────────────────────────────────────────────
router.use('/auth', authRouter);

// ── Shared features ───────────────────────────────────────────────────────────
router.use('/notifications', notificationsRouter);
router.use('/flash-deals', flashDealsRouter);
router.use('/products', productsRouter);
router.use('/categories', (req, res, next) => {
  req.url = '/categories' + (req.url === '/' ? '' : req.url);
  productsRouter(req, res, next);
});
router.use('/upload', uploadRouter);
router.use('/telegram', telegramRouter);
router.use('/referral', referralRouter);
router.use('/special-offers', specialOffersRouter);
router.use('/customers', customersRouter);
router.use('/admin', adminPartnersRouter);
router.use('/admin', adminUsersRouter);
router.use('/bids', bidsRouter);
router.use('/support', supportRouter);
router.use('/banners', bannersRouter);
router.use('/cart', cartRouter);
router.use('/orders', ordersRouter);
router.use('/wallet', walletRouter);
router.use('/payment-methods', paymentMethodsRouter);
router.use('/auctions', auctionsRouter);
router.use('/wishlist', wishlistRouter);
router.use('/reviews', reviewsRouter);
router.use('/recently-viewed', recentlyViewedRouter);
router.use('/marketing', marketingRouter);
router.use('/about', aboutRouter);
router.use('/app-update', appUpdateRouter);

// ── Partner routes ────────────────────────────────────────────────────────────
router.use('/partner/auth', partnerAuthRouter);
router.use('/partner/dashboard', partnerDashboardRouter);
router.use('/partner/products', partnerProductsRouter);
router.use('/partner/orders', partnerOrdersRouter);
router.use('/partner/inventory', partnerInventoryRouter);
router.use('/partner/earnings', partnerEarningsRouter);
router.use('/partner/profile', partnerProfileRouter);
router.use('/partner/reviews', partnerReviewsRouter);
router.use('/partner/promotions', partnerPromotionsRouter);
router.use('/partner/settings', partnerSettingsRouter);

module.exports = router;
