#!/usr/bin/env sh
VERSION="$(node -p "require('./backend/package.json').version")"
docker build -t "zenflow-api:${VERSION}" -t zenflow-api:latest -f backend/Dockerfile .
