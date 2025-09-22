#!/bin/bash

# Usage: make_publisher.sh <ACCOUNT> <CHAIN_URL>
#
# This script creates two files
# - setup.json contains a transaction that will create the
#   account and set it as the default package source for root.
# - credentials.json contains the login credentials that
#   will be used to publish packages.
#

NAME=${1:-gh-actions}
URL=${2:-http://psibase.localhost:8080/}

echo Creating ${NAME} for ${URL}

PRV=`openssl genpkey -outform PEM -algorithm EC -pkeyopt ec_paramgen_curve:P-256`
PUB=`openssl pkey -pubout -outform DER <<< "$PRV" | xxd -p -c0`

openssl pkey -pubout -outform PEM <<< "$PRV" > key.pem

jq -n -c --arg name "$NAME" --arg key "$PUB" > setup.json '[
    {"sender":"root","service":"auth-sig","method":"newaccount","data":{"name":$name,"key":$key}},
    {"sender":"root","service":"packages","method":"setsources","data":{"sources":[{"account":$name}]}}
]'

jq -n -c --arg url "$URL" --arg account "$NAME" --arg key "$PRV" > credentials.json '{
    "url": $url,
    "account": $account,
    "key": $key
}'
