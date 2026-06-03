# API Contracts

Base URL: `/api/v1`  
Auth: All endpoints (except auth routes) require `Authorization: Bearer <JWT>`.  
Content-Type: `application/json`

---

## Auth

### POST /auth/register

Create a new user account.

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "min8chars"
}
```

**Response 201:**
```json
{
  "user": { "id": "uuid", "email": "user@example.com" },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

**Errors:** `409` email already exists | `422` validation failed.

---

### POST /auth/login

**Request body:**
```json
{ "email": "user@example.com", "password": "..." }
```

**Response 200:**
```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }
```

**Errors:** `401` invalid credentials.

---

### POST /auth/refresh

Exchange a refresh token for a new access token.

**Request body:** `{ "refreshToken": "eyJ..." }`  
**Response 200:** `{ "accessToken": "eyJ..." }`

---

### POST /auth/logout

Invalidates the refresh token (Redis blacklist).

**Response 204:** No content.

---

## Users

### GET /users/me

Returns the authenticated user's profile and preferences.

**Response 200:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "timezone": "Asia/Saigon",
  "workStart": 540,
  "workEnd": 1020,
  "workDays": [1, 2, 3, 4, 5],
  "roleArchetypeId": "night-owl-dev",
  "onboardingComplete": true
}
```

---

### PUT /users/me/preferences

Update work schedule preferences. Triggers full EDF rescheduling of all PENDING tasks.

**Request body:**
```json
{
  "workStart": 480,
  "workEnd": 1020,
  "workDays": [1, 2, 3, 4, 5],
  "timezone": "Asia/Ho_Chi_Minh"
}
```

**Response 200:** Updated user preferences object.

---

### POST /users/me/onboarding

Complete onboarding. Called once after registration.

**Request body:**
```json
{
  "workStart": 540,
  "workEnd": 1020,
  "workDays": [1, 2, 3, 4, 5],
  "roleArchetypeId": "night-owl-dev"
}
```

**Response 200:** User object with `onboardingComplete: true`.

---

## Tasks

### GET /tasks

List tasks for the current user, filtered by view window.

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `view` | `day\|week\|month` | Required. Filters by the scheduling horizon. |
| `date` | ISO date string | Required. The reference date (e.g., `2026-06-01`). |
| `status` | `PENDING\|DONE\|all` | Default: `all` |

**Response 200:**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "Index Refactor",
      "durationMinutes": 75,
      "deadline": "2026-06-02T17:00:00Z",
      "tags": ["backend", "critical"],
      "fixed": false,
      "startTime": 0,
      "status": "PENDING",
      "rrule": "",
      "scheduledStartTime": "2026-06-01T09:15:00+07:00",
      "createdAt": "2026-06-01T07:30:00Z"
    }
  ],
  "meta": {
    "totalAllocatedMinutes": 300,
    "totalWorkMinutes": 480,
    "conflictCount": 1
  }
}
```

---

### POST /tasks

Create a new task. The engine assigns `scheduledStartTime`.

**Request body:**
```json
{
  "title": "Index Refactor",
  "durationMinutes": 45,
  "deadline": "2026-06-02T17:00:00Z",
  "tags": ["backend", "critical"],
  "fixed": false,
  "startTime": 0,
  "rrule": ""
}
```

**Response 201:**
```json
{
  "task": { ...full task object... },
  "schedulingMeta": {
    "biasApplied": 1.5,
    "adjustedDuration": 75,
    "placedAt": "2026-06-01T09:15:00+07:00",
    "engine": "bandit"
  }
}
```

**Errors:** `422` duration not multiple of 15 | `409` no slot available (task created with `status: CONFLICT`).

---

### GET /tasks/:id

Get a single task with its event history.

**Response 200:**
```json
{
  "task": { ...full task object... },
  "events": [
    { "eventType": "CREATE", "occurredAt": "...", "newSnapshot": {...} },
    { "eventType": "MOVE", "occurredAt": "...", "oldSnapshot": {...}, "newSnapshot": {...} }
  ],
  "estimationBias": { "backend": 1.2, "critical": 1.5 }
}
```

---

### PATCH /tasks/:id

Update task metadata. Does not trigger rescheduling.

**Request body (partial):**
```json
{
  "title": "Updated Title",
  "tags": ["backend"],
  "deadline": "2026-06-03T17:00:00Z"
}
```

**Response 200:** Updated task object.

---

### PATCH /tasks/:id/reschedule

Manually move a task to a specific start time.

**Request body:**
```json
{ "requestedStartTime": "2026-06-01T13:00:00+07:00" }
```

**Response 200:**
```json
{
  "task": { ...updated task... },
  "displaced": [
    { "taskId": "uuid", "newScheduledStartTime": "..." }
  ]
}
```

The `displaced` array contains any tasks that were cascade-moved as a result.

---

### PATCH /tasks/:id/complete

Mark a task as done.

**Response 200:** Task with `status: "DONE"`.

---

### DELETE /tasks/:id

Delete a task and its event history.

**Response 204:** No content.

---

## Estimation Bias

### GET /users/me/bias

Returns all tag bias multipliers for the authenticated user.

**Response 200:**
```json
{
  "biases": [
    { "tag": "backend", "multiplier": 1.2, "sampleCount": 12, "updatedAt": "..." },
    { "tag": "critical", "multiplier": 1.5, "sampleCount": 8, "updatedAt": "..." }
  ]
}
```

---

## Error Format

All errors follow a consistent envelope:

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "durationMinutes must be a positive multiple of 15",
  "field": "durationMinutes"
}
```
