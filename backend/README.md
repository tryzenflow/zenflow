# Linklytics API

## Overview
Linklytics API is built with NestJS, a Node.js framework for building scalable backend systems.

## Setup
### Prerequisites
* [Node.js 22.x and higher](https://nodejs.org)
* [Docker](https://www.docker.com/products/docker-desktop/)
* Yarn (`npm i -g yarn@latest`)

### Clone the repository
```bash
git clone https://github.com/ttalpha/linklytics.git
cd backend/
```

### Install all the dependencies
```bash
yarn
```

### Environment variables
Create two files: `.env.dev` (for development) and `.env.test` (for testing)

`.env.dev`:

```bash
DATABASE_URL="postgres://admin:admin@localhost:5432/linklytics?sslmode=disable&schema=public"
```

`.env.test`:

```bash
DATABASE_URL="postgres://admin:admin@localhost:5433/linklytics-test?sslmode=disable&schema=public"
```

### Run Docker Compose
For development, create a `docker.dev.env` file and add:
```bash
POSTGRES_USER=admin
POSTGRES_PASSWORD=admin
POSTGRES_DB=linklytics
PGADMIN_DEFAULT_EMAIL=admin@admin.com
PGADMIN_DEFAULT_PASSWORD=admin
```

For testing, create a `docker.test.env` file and add:
```bash
POSTGRES_USER=admin
POSTGRES_PASSWORD=admin
POSTGRES_DB=linklytics-test
PGADMIN_DEFAULT_EMAIL=admin@admin.com
PGADMIN_DEFAULT_PASSWORD=admin
```

Run Docker Compose file (in detached mode):
```bash
docker compose -f compose.dev.yml up -d
```

### Start the backend application
Run NestJS application by:

```bash
yarn start:dev
```
The app is up and running at [http://localhost:5000](http://localhost:5000)

## Testing
### Unit tests

Run:
```bash
yarn test
# or run in watch mode
yarn test -w
```

### E2E tests
Run:
```bash
yarn test:e2e
```