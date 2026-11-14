const {
  generateReferralCode,
  validateReferralCode,
  applyReferralCode,
  getReferralStats,
  convertCoinsToBalance,
} = require('./referral.service');

async function generateCode(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const result = await generateReferralCode(userId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function validateCode(req, res, next) {
  try {
    const { code } = req.params;
    const referral = await validateReferralCode(code);

    if (!referral) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid or expired referral code' 
      });
    }

    res.json({ success: true, data: referral });
  } catch (error) {
    next(error);
  }
}

async function applyCode(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { referralCode } = req.body;
    const result = await applyReferralCode(userId, referralCode);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function getStats(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const stats = await getReferralStats(userId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}

async function convertCoins(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { coins } = req.body;
    if (!Number.isInteger(coins) || coins <= 0 || coins > 1000000) {
      return res.status(400).json({ success: false, message: 'Coins must be a whole number between 1 and 1,000,000' });
    }

    const result = await convertCoinsToBalance(userId, coins);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generateCode,
  validateCode,
  applyCode,
  getStats,
  convertCoins,
};
