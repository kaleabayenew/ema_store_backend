# Ema Store — Backend API

REST API server powering both the **customer** (`ema store`) and **partner** (`Ema Store Partner`) Flutter apps.

## Structure

```
backend/
├── src/
│   ├── server.js              # Entry point
│   ├── app.js                 # Express app setup
│   ├── core/
│   │   ├── config/            # Environment config, DB connection
│   │   ├── middleware/        # Auth, error handler, rate limiter
│   │   ├── utils/             # Helpers (JWT, SMS, response formatter)
│   │   └── errors/            # Custom error classes
│   ├── models/                # Database models / schemas
│   ├── routes/                # Route index (mounts all feature routers)
│   └── features/
│       ├── auth/              # Customer auth (sign up, sign in, OTP, reset)
│       ├── products/          # Product catalogue, search, categories
│       ├── orders/            # Customer order management
│       ├── cart/              # Cart operations
│       ├── checkout/          # Checkout & payment
│       ├── profile/           # Customer profile
│       ├── notifications/     # Push & local notifications
│       ├── support/           # AI support chat
│       └── partner/
│           ├── auth/          # Partner sign up, sign in, OTP
│           ├── dashboard/     # Dashboard stats
│           ├── products/      # Partner product CRUD
│           ├── orders/        # Incoming orders management
│           ├── inventory/     # Stock management
│           ├── earnings/      # Earnings & payouts
│           ├── promotions/    # Discounts & flash deals
│           ├── reviews/       # Customer reviews
│           ├── profile/       # Partner shop profile
│           └── settings/      # Partner settings
├── assets/
│   └── images/                # Shared image assets (logos, etc.)
├── test/
│   ├── features/              # Feature-level integration tests
│   └── core/                  # Unit tests for core utilities
├── docs/                      # API documentation
├── scripts/                   # DB seed scripts, migrations
├── .env.example               # Environment variable template
├── package.json
└── README.md
```

## Getting Started

```bash
cp .env.example .env
# fill in .env values
npm install
npm run dev
```

## API Base URL

```
http://localhost:3000/api/v1
```

## Apps

| App | Description |
|---|---|
| `customer` | Ema Store customer Flutter app |
| `partner` | Ema Store Partner Flutter app |
# Ema Store Backend
