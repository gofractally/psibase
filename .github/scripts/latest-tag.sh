#!/bin/bash

# references: 
#   https://github.community/t/how-to-check-if-a-container-image-exists-on-ghcr/154836/3
#   https://gist.github.com/eggplants/a046346571de66656f4d4d34de69fdd0

USER_IMAGE="$1"

# get token ('{"token":"***"}' -> '***')
TOKEN="$(
  curl "https://ghcr.io/token?scope=repository:${USER_IMAGE}:pull" |
  awk -F'"' '$0=$4'
)"
_curl(){ curl -s -H "Authorization: Bearer ${TOKEN}" "$1" 2>&1; }

# get most recent tag
LAST_TAG=$(_curl "https://ghcr.io/v2/${USER_IMAGE}/tags/list" | jq -r '.tags[-1]')
echo "${LAST_TAG}"