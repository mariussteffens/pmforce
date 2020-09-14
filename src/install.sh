#!/usr/bin/env bash
rm -rf node_modules
rm package-lock.json
npm install argparse psl pg readline-sync event-stream readline-sync md5 bufferutil webpack webpack-cli puppeteer
mkdir log
mkdir err
