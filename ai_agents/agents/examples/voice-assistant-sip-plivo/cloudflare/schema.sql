-- SuperYou demo schema - mirrors Shopify's data model (products, orders,
-- line_items, fulfillments) as superyou.in runs on Shopify. Fulfillment
-- tracking fields mirror what ClickPost feeds back into Shopify.

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,              -- Shopify product id
  handle TEXT UNIQUE,
  title TEXT NOT NULL,
  product_type TEXT,
  vendor TEXT DEFAULT 'SuperYou',
  price REAL,                          -- first variant price (INR)
  grams INTEGER,
  body_text TEXT                       -- plain-text product description
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,                          -- E.164, +91...
  default_city TEXT,
  orders_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_number TEXT UNIQUE,            -- e.g. #SY10042
  customer_id INTEGER REFERENCES customers(id),
  phone TEXT,
  financial_status TEXT,               -- paid | refunded | partially_refunded
  fulfillment_status TEXT,             -- NULL | fulfilled | partial
  total_price REAL,
  shipping_city TEXT,
  created_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);

CREATE TABLE IF NOT EXISTS order_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  title TEXT,
  quantity INTEGER,
  price REAL
);
CREATE INDEX IF NOT EXISTS idx_line_items_order ON order_line_items(order_id);

CREATE TABLE IF NOT EXISTS fulfillments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  status TEXT,                         -- pending | open | success | cancelled | error | failure
  tracking_company TEXT,               -- courier selected by ClickPost
  tracking_number TEXT,                -- AWB
  shipment_status TEXT,                -- label_created | picked_up | in_transit | out_for_delivery | attempted_delivery | delivered | failure
  estimated_delivery_at TEXT,
  last_checkpoint TEXT,
  last_checkpoint_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fulfillments_order ON fulfillments(order_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL,
  caller TEXT,
  role TEXT NOT NULL,                  -- user | assistant | tool
  content TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transcripts_call ON transcripts(call_id);
