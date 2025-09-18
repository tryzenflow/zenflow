# Zenflow API

## Overview
Zenflow API is built with NestJS, a Node.js framework for building scalable backend systems.

## Setup (for the frontend to consume only)
### Prerequisites
[Docker](https://www.docker.com/products/docker-desktop/)

### Clone the repository
```bash
git clone https://github.com/ttalpha/zenflow.git
cd backend/
```

### Build docker images
```bash
cd backend/
sh build_images.sh
```

### Add environment variables
Create a `.env.prod` file in the `backend/` directory and add:
```env
DATABASE_URL="postgres://admin:admin@zenflow-db-prod:5432/zenflow-prod?sslmode=disable&schema=public"
CACHE_URL="redis://zenflow-cache-prod:6379"
CORS_ORIGIN="http://localhost:3000"
MAIL_TRANSPORT="smtp://zenflow-mail-prod:25"
SESSION_SECRET='s3cr3t'
GRPC_SCHEDULER_URL='zenflow-scheduler-prod:50051'
```

Create a `docker.env` file in the `backend/` directory and add:
```env
POSTGRES_USER=admin
POSTGRES_PASSWORD=admin
POSTGRES_DB=zenflow-prod
```

### Run Docker compose
```bash
docker compose up -d
```

The API is available at [http://localhost:5000](http://localhost:5000)

For the documentation of the API, go to [http://localhost:5000/api](http://localhost:5000/api)