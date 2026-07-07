#!/bin/bash

# SuperYou Voice Agent Console — frontend startup script

echo "🚀 Starting SuperYou Voice Agent console..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "⚙️  Creating .env.local file..."
    cat > .env.local << EOF
# Call server configuration (same-origin by default in production;
# override for local development)
NEXT_PUBLIC_TWILIO_SERVER_URL=http://localhost:8080
NEXT_PUBLIC_TENAPP_SERVER_URL=http://localhost:8080
EOF
    echo "✅ Created .env.local file with default configuration"
    echo "📝 Adjust the server URLs in .env.local if needed"
fi

echo "🎯 Starting development server..."
echo "📱 Console will be available at: http://localhost:3000"
echo "🔗 Make sure the call server is running on: http://localhost:8080"
echo ""

npm run dev
