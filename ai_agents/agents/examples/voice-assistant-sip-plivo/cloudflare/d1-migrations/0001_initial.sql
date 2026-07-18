-- Initial SuperYou staging schema. Transcript identity columns are added by 0002.
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  handle TEXT UNIQUE,
  title TEXT NOT NULL,
  product_type TEXT,
  vendor TEXT DEFAULT 'SuperYou',
  price REAL,
  grams INTEGER,
  body_text TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  default_city TEXT,
  orders_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_number TEXT UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  phone TEXT,
  financial_status TEXT,
  fulfillment_status TEXT,
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
  status TEXT,
  tracking_company TEXT,
  tracking_number TEXT,
  shipment_status TEXT,
  estimated_delivery_at TEXT,
  last_checkpoint TEXT,
  last_checkpoint_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fulfillments_order ON fulfillments(order_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL,
  caller TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transcripts_call ON transcripts(call_id);
