#!/bin/bash

URL=$( echo "$PUBLISH_LOGIN" | jq -r '.["url"]' )
ACCOUNT=$( echo "$PUBLISH_LOGIN" | jq -r '.["account"]' )
KEY=/tmp/publish-key
echo "$PUBLISH_LOGIN" | jq -r '.["key"]' > $KEY

rust/release/psibase publish -a \"$URL\" -S \"$ACCOUNT\" -s $KEY share/psibase/packages/*.psi
