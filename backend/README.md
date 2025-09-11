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


## API endpoints

For full details of the API, run Docker Compose and go to [http://localhost:5000/api](http://localhost:5000/api).

### Auth
#### `POST /auth/otp/request`: Request a new OTP code to login

Request body:
```json
{
  "email": "email@example.com"
}
```

Response (200 OK):

```json
{
  "message": "OTP code sent to email e***l@example.com successfully"
}
```

#### `POST /auth/otp/verify`: Verify OTP code

Request body:
```json
{
  "email": "tim@foo.com",
  "otp": "679755"
}
```

Response (200 OK):

```json
{
  "id": "b0aee7cb-69fb-43c4-9c9e-c01a00361858",
  "name": "New User",
  "email": "tim@foo.com",
  "createdAt": "2025-09-10T10:31:17.443Z",
  "timezone": "Europe/Paris"
}
```

If the OTP code doesn't exist or it expires, the response is a 404 Not Found with the payload:
```json
{
  "message": "OTP Code is not found or may have been expired"
}
```

If the OTP code is incorrect, the response is a 400 Bad Request with the payload:
```json
{
  "message": "Incorrect OTP provided"
}
```

#### `GET /auth/me` (auth required): get current logged in user

Response (200 OK):
```json
{
  "id": "b0aee7cb-69fb-43c4-9c9e-c01a00361858",
  "name": "New User",
  "email": "tim@foo.com",
  "createdAt": "2025-09-10T10:31:17.443Z",
  "timezone": "Europe/Paris"
}
```

If no user is logged in, an 403 Forbidden is returned.


#### `POST /auth/logout` (auth required): log out

Response (204 No Content)

### Tasks

#### `POST /tasks` (auth required): create a new task
```json
{
  "title": "Clean house",
  "duration": 15,
  "priority": 3,
  "energyLevel": 1,
  "earliestStart": 1020,
  "latestEnd": 1140,
  "mandatory": false,
  "categoryId": "384380b8-822e-4a43-bfe1-c6f096318eaf"
}
```

Response (201 Created):

```json
{
  "id": "93fde419-3594-4181-8a58-b6b3f2c60c84",
  "title": "Clean house",
  "duration": 15,
  "priority": 3,
  "fixedStart": null,
  "earliestStart": 1020,
  "latestEnd": 1140,
  "deadline": null,
  "mandatory": false,
  "splittable": false,
  "maxSplits": 1,
  "energyLevel": 1,
  "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1",
  "categoryId": "384380b8-822e-4a43-bfe1-c6f096318eaf",
  "createdAt": "2025-09-10T14:28:39.549Z"
}
```

#### `PATCH /tasks/:id` (auth required): update a task by its `id`

Request body:

```json
{
  "latestEnd": 1080
}
```

Response (200 OK):
```json
{
  "id": "93fde419-3594-4181-8a58-b6b3f2c60c84",
  "title": "Clean house",
  "duration": 15,
  "priority": 3,
  "fixedStart": null,
  "earliestStart": 1020,
  "latestEnd": 1080,
  "deadline": null,
  "mandatory": false,
  "splittable": false,
  "maxSplits": 1,
  "energyLevel": 1,
  "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1",
  "categoryId": "384380b8-822e-4a43-bfe1-c6f096318eaf",
  "createdAt": "2025-09-10T14:28:39.549Z"
}
```

#### `DELETE /tasks` (auth required): delete a task by its `id`

Response: 204 No Content

### Categories
#### `GET /categories` (auth required): get all the user's categories
```json
[
  {
    "id": "8a343087-f3af-46fb-a068-32a266736ad4",
    "name": "💼 Work / Study",
    "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
  },
  {
    "id": "121f7bf4-2a39-4fb2-8d40-3e56ceef2b6e",
    "name": "🍽️ Meals",
    "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
  },
  {
    "id": "e506e572-9cd6-4c2a-ac8f-4ca866dc1e65",
    "name": "👨‍👩‍👧 Personal / Family",
    "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
  },
  {
    "id": "384380b8-822e-4a43-bfe1-c6f096318eaf",
    "name": "🧹 Chores / Errands",
    "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
  },
  {
    "id": "d5f39efc-9c45-4c84-b242-082fd590b592",
    "name": "🎮 Leisure",
    "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
  },
  {
    "id": "fa39f8cf-b5fd-4138-bf78-ed76d1a73bf3",
    "name": "Health",
    "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
  },
]
```

#### `POST /categories/populate` (auth required): Populate some default categories. Call once upon user creation.

Request body: N/A

Response: N/A (201 Created)


#### `POST /categories` (auth required): Create a new category

Request body:
```json
{
  "name": "Self-care"
}
```

Response:
```json
{
  "id": "16333a01-a9d4-4773-9621-f8d4dea9bac5",
  "name": "Self-care",
  "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
}
```

#### `PUT /categories/:id` (auth required): Update an existing category by its `id`.

Request body:
```json
{
  "name": "Care"
}
```

Response:
```json
{
  "id": "16333a01-a9d4-4773-9621-f8d4dea9bac5",
  "name": "Care",
  "userId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
}
```

> If the category with the given `id` doesn't exist, a 404 will be returned.

#### `DELETE /categories/:id` (auth required): Delete an existing category by its `id`.

> If the category with the given `id` doesn't exist, a 404 will be returned.

### Schedules

#### `GET /schedules?start=<start>&end=<end>` (auth required): get the user's schedules from `start` to `end` (exclusive)

`<start>` and `<end>` are required and they have to be date strings in the format of `yyyy-mm-dd`.

Response:
```json
[
  {
    "start": "2025-09-10T04:00:00.000Z",
    "end": "2025-09-10T04:30:00.000Z",
    "split": 0,
    "taskId": "183a229c-37ac-430d-bbb0-2eb70bf5874f",
    "task": {
        "title": "Morning Exercise"
    }
  },
  {
    "start": "2025-09-10T04:45:00.000Z",
    "end": "2025-09-10T05:45:00.000Z",
    "split": 0,
    "taskId": "0ea8204c-edbc-468b-8f4f-980cdaa61482",
    "task": {
      "title": "Breakfast"
    }
  },
  // ...
]
```


#### `PUT /schedules/:year/:month/:day/tasks/:id/split/:split` (auth required): update a particular split of a task's schedule on a particular date

Request body:
```json
{
  "start": "2025-09-10T11:15:00.000Z",
  "end": "2025-09-10T14:50:00.000Z"
}
```

Response (200 OK):
```json
{
  "start": "2025-09-10T11:15:00.000Z",
  "end": "2025-09-10T14:50:00.000Z",
  "split": 1,
  "taskId": "f1338e50-0de6-4bd2-bc97-e561c7beaa70"
}
```

#### `DELETE /schedules/:year/:month/:day/tasks/:id/split/:split`: delete a particular split of a task's schedule on a particular date

Response: N/A (204 No Content)

### Scheduler

#### `POST /schedule`: schedule tasks

Request body:
```json
{
  "scheduleDate": "2025-09-10",
  "taskIds": [
    "183a229c-37ac-430d-bbb0-2eb70bf5874f",
    "0ea8204c-edbc-468b-8f4f-980cdaa61482",
    "f1338e50-0de6-4bd2-bc97-e561c7beaa70",
    "5d66e3d9-11d3-480f-b35b-6521bea60160",
    "0c4bb3d8-e1c1-4334-a8fd-48ce8b19a361",
    "076cf794-0d13-4745-8ec4-7a15f812161e",
    "a8c3186d-e8d9-4ab8-b285-281683dfbd96",
    "611becb4-da77-4a6c-9ead-fcbe6d2ad372",
    "a31cb81c-47ed-4095-adfe-8505d807b3fb",
    "78e16025-4951-45af-9f14-474c169cee5f",
    "a3f4d7da-1a2b-4d09-9fff-531162d37469"
  ]
}
```

Response (201 Created):
```json
[
  {
    "start": "2025-09-10T04:00:00.000Z",
    "end": "2025-09-10T04:30:00.000Z",
    "split": 0,
    "taskId": "183a229c-37ac-430d-bbb0-2eb70bf5874f",
  },
  {
    "start": "2025-09-10T04:45:00.000Z",
    "end": "2025-09-10T05:45:00.000Z",
    "split": 0,
    "taskId": "0ea8204c-edbc-468b-8f4f-980cdaa61482",
  },
  // ...
]
```

### Constraints
#### `POST /constraints` (auth required): Create a constraint for the user

Request body:
```json
{
  "availableHours": [{ "start": 360, "end": 1320 }],
  "minGapBetweenTasks": 10,
  "maxDailyLoad": 360,
  "batchSimilarTasks": true,
  "energyBlocks": [
    {"energyLevel": 1, "start": 360, "end": 480},
    {"energyLevel": 3, "start": 480, "end": 660},
    {"energyLevel": 1, "start": 660, "end": 840},
    {"energyLevel": 2, "start": 840, "end": 1020},
    {"energyLevel": 1, "start": 1020, "end": 1140},
    {"energyLevel": 2, "start": 1140, "end": 1260},
    {"energyLevel": 1, "start": 1260, "end": 1320}
  ]
}
```

Response (201 Created):
```json
{
  "availableHours": [{ "start": 360, "end": 1320 }],
  "minGapBetweenTasks": 10,
  "maxDailyLoad": 360,
  "batchSimilarTasks": true,
  "energyBlocks": [
    {"energyLevel": 1, "start": 360, "end": 480},
    {"energyLevel": 3, "start": 480, "end": 660},
    {"energyLevel": 1, "start": 660, "end": 840},
    {"energyLevel": 2, "start": 840, "end": 1020},
    {"energyLevel": 1, "start": 1020, "end": 1140},
    {"energyLevel": 2, "start": 1140, "end": 1260},
    {"energyLevel": 1, "start": 1260, "end": 1320}
  ],
  "id": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1" // matches the userId
}
```

> If a user has already created a constraint before, this will return a 400 Bad Request
> ```json
> {
>    "message": "Constraint for the user already exists",
>    "error": "Bad Request",
>    "statusCode": 400
> }

#### `GET /constraints` (auth required): get user constraints

```json
{
  "minGapBetweenTasks": 15,
  "maxDailyLoad": 180,
  "batchSimilarTasks": true,
  "id": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1",
  "createdAt": "2025-09-09T15:04:07.471Z",
  "updatedAt": "2025-09-09T15:12:16.710Z",
  "availableHours": [
    {
      "id": "ac4ae0c3-3f0c-4e15-a459-63124b4c38c7",
      "start": 420,
      "end": 1260,
      "constraintsId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
    }
  ],
  "energyBlocks": [
    {
      "id": "7c2dc1c2-d132-400b-8760-61f23a17c3da",
      "energyLevel": 1,
      "start": 420,
      "end": 540,
      "constraintsId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
    },
    {
      "id": "675b2a78-37ef-4dc7-9ea3-2b781c116103",
      "energyLevel": 3,
      "start": 540,
      "end": 720,
      "constraintsId": "aa0ceba1-8756-4c8f-8aa9-c758b01a43d1"
    }
    // ...
  ]
}
```

#### `PATCH /constraints` (auth required): update user's constraints