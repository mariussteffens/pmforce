#!/usr/bin/env bash
for i in `seq $1 $2`; do
    echo "Starting crawler with id $i";
    ./keepalive.sh "--crawler_id $i  --user_data_dir /tmp/node-crawler$i/ ${@:3}" 2>> err/crawler$i.log >> log/crawler$i.log &
    sleep 1
done
