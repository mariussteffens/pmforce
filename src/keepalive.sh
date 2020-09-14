#!/usr/bin/env bash
while true; do
    echo "node start.js $@;";
    node --max-old-space-size=8192 crawly.js $@;
    retval=$?
    if [ $retval -eq 42 ]; then
            break;
    fi
    if [ $retval -ne 0 ]; then
            sleep 10;
    fi
done
