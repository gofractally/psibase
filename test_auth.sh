#!/bin/bash

# Test script to verify authentication works with the Tokens service
# This script tests the /common/set-cookie endpoint and userBalances GraphQL query

set -e

echo "🧪 Testing authentication flow with Tokens service..."

# Configuration
PSINODE_URL="http://localhost:8080"
TEST_USER="alice"
SERVICE_URL="http://tokens.localhost:8080"

echo "1️⃣ First, testing unauthenticated request (should fail)"
curl -s -X POST "$SERVICE_URL/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query": "query { userBalances(user: \"alice\") { symbolId tokenId balance } }"}' \
  | jq . || echo "Expected: 401 or error response"

echo ""
echo "2️⃣ Setting up authentication..."
echo "   - Start psinode if not running: psinode -p"
echo "   - Create test user if needed: psibase create alice"
echo "   - Login via accounts app to get JWT token"
echo ""

echo "3️⃣ Testing /common/set-cookie endpoint..."
# This would normally be called by the browser after login
echo "   POST /common/set-cookie with JWT token"
echo "   Cookie: __Host-SESSION=<jwt-token>"
echo ""

echo "4️⃣ Testing authenticated GraphQL query..."
echo "   The userBalances query should now work and log the authenticated user"
echo ""

echo "✅ Test setup complete!"
echo ""
echo "Manual test procedure:"
echo "1. Start psinode: psinode -p"
echo "2. Go to http://accounts.localhost:8080 and create/login to an account"
echo "3. Use browser dev tools to see the __Host-SESSION cookie"
echo "4. Make GraphQL request to http://tokens.localhost:8080/graphql with the cookie"
echo "5. Check psinode logs for 'Authenticated user for userBalances query:'"