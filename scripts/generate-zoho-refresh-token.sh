#!/bin/bash

# Script to generate Zoho Refresh Token from Self Client Code
# Usage: ./scripts/generate-zoho-refresh-token.sh YOUR_CODE

if [ -z "$1" ]; then
    echo "Usage: ./scripts/generate-zoho-refresh-token.sh YOUR_CODE"
    echo ""
    echo "Example:"
    echo "  ./scripts/generate-zoho-refresh-token.sh 1000.fbe0688adb435c5c0d7c9455982a2741.5f2dfad3bf..."
    exit 1
fi

CODE=$1

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

if [ -z "$ZOHO_CLIENT_ID" ] || [ -z "$ZOHO_CLIENT_SECRET" ]; then
    echo "Error: ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET not found in .env"
    exit 1
fi

echo "Exchanging code for refresh token..."
echo "Code: $CODE"
echo ""

RESPONSE=$(curl -s -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=$ZOHO_CLIENT_ID" \
  -d "client_secret=$ZOHO_CLIENT_SECRET" \
  -d "redirect_uri=http://localhost:3000" \
  -d "code=$CODE")

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Extract refresh token if successful
REFRESH_TOKEN=$(echo "$RESPONSE" | grep -o '"refresh_token":"[^"]*' | cut -d'"' -f4)

if [ -n "$REFRESH_TOKEN" ]; then
    echo ""
    echo "✅ Success! Refresh Token:"
    echo "$REFRESH_TOKEN"
    echo ""
    echo "Add this to your .env file:"
    echo "ZOHO_REFRESH_TOKEN=$REFRESH_TOKEN"
else
    echo ""
    echo "❌ Failed to get refresh token. Check the error above."
fi

