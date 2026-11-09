const { Router } = require('express');
const ctrl = require('./products.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();
const guard = [requireAuth, requirePartner];

router.get('/',                         ...guard, ctrl.getProducts);
router.post('/',                        ...guard, ctrl.createProduct);
router.get('/:id',                      ...guard, ctrl.getProduct);
router.put('/:id',                      ...guard, ctrl.updateProduct);
router.delete('/:id',                   ...guard, ctrl.deleteProduct);
router.patch('/:id/visibility',         ...guard, ctrl.toggleVisibility);
router.post('/:id/images',              ...guard, ctrl.uploadImage);
router.delete('/:id/images/:imgId',     ...guard, ctrl.deleteImage);

module.exports = router;
