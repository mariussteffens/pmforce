#!/usr/bin/env bash
node crawly.js --mode clean --module pm
node crawly.js --mode init --alexa urls.csv --alexaPattern 'u' --description 'local tests' --createTables
node crawly.js --mode setup --module pm

