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

## Database Design

![Database Design](./assets/image.png)

### Elaboration

- `earliestStart` and `latestEnd` allow flexible scheduling within the range. If `latestEnd - earliestStart = duration`, the task is fixed.
- `maxDailyLoad` drops optional tasks that demand high mental energy if the total duration exceeds it.
- `batchSimilarTasks` groups tasks with similar categories together to minimize context switching.
- `minGapBetweenTasks` defines the minimum minutes to take a break between two tasks (if time allows).
- `day` is a value between 0 and 6, with respect to Monday to Sunday.
- `dayOrdinal` tells whether the task is repeated on the first/second/third day of the month/year. It can be -1 (last day), or from 0-5 corresponding to the first/second/third, etc.
- `firstWorkday` and `lastWorkday` are booleans indicating whether repeat rules should be applied to the first or last workday of a month.
- `timezone` is a string of the user’s timezone e.g., Europe/Paris, Asia/Ho Chi Minh, America/New York, which is used to shift from UTC to the local timezone.
- `focus` is the **mental** energy level required to perform a task (in the `Task` table), corresponding to the user’s `level` at a particular point in the `EnergyBlock` table. The value can range from 1 to 3.
- The `RepeatRule` table will have a column `days`, which is an array of days to repeat (repeat by week only) instead of a separate table `RepeatWeekday` like above.