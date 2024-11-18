#!/bin/bash

CMAKE_COMMAND="$1"
DIR="$2"
shift 2

MYDIR=`mktemp -d`
pushd "$MYDIR" >/dev/null

first=1
echo -n '['
for package in "$@"; do
    if (( $first )); then
        first=0
    else
        echo -n ','
    fi
    file=${package}.psi
    "${CMAKE_COMMAND}" -E tar xf "${DIR}/${file}" --format=zip meta.json
    HASH=`"${CMAKE_COMMAND}" -E sha256sum "${DIR}/${file}" | head -c 64`
    sed -E '$s/\}[[:space:]]*$/,/' meta.json
    echo -n "\"file\":\"${file}\",\"sha256\":\"${HASH}\"}"
done
echo -n ']'

popd >/dev/null
rm -r "$MYDIR"
