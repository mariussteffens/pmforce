#!/usr/bin/env bash
rm -rf node_modules
rm package-lock.json
npm install argparse psl pg readline-sync event-stream readline-sync md5 bufferutil puppeteer
npm install -g --save-dev webpack-cli@3.3.12 webpack@4.46
mkdir log
mkdir err
