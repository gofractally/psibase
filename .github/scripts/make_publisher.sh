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

jq -c > setup.json <<EOF
[
    {"sender":"root","service":"auth-sig","method":"newaccount","data":{"name":"$NAME","key":"$PUB"}},
    {"sender":"root","service":"packages","method":"setsources","data":{"sources":[{"account":"$NAME"}]}}
]
EOF

jq -c > credentials.json <<EOF
{
    "url": "$URL",
    "account": "$NAME",
    "key": `jq -R -s <<< $PRV`
}
EOF
