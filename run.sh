#!/bin/bash 

node --version

while :
do
    echo waiting for 1s
    sleep 1s
    node build/from_steam.js
    echo waiting for 30s
    sleep 30s
done
