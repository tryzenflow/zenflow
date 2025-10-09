
## 📋 DANH SÁCH API ENDPOINTS

### 🔐 **1. AUTHENTICATION APIs**

#### **1.1 Gửi OTP**
```typescript
POST /api/auth/send-otp

// Request
{
  email: "user@example.com"
}

// Response
{
  message: "OTP sent successfully",
  email: "user@example.com"
}

#### **1.2 Xác thực OTP & Đăng nhập**
```typescript
POST /api/auth/verify-otp

// Request
{
  email: "user@example.com",
  otp: "123456"
}

// Response
{
  accessToken: "eyJhbGc...",
  refreshToken: "eyJhbGc...",
  user: {
    id: "user-id",
    email: "user@example.com",
    displayName: "John Doe",
    timezone: "UTC+7"
  }
}

// Cách sử dụng
const response = await authService.verifyOTP({ 
  email: 'user@example.com',
  otp: '123456'
});
```

#### **1.3 Đăng xuất**
```typescript
POST /api/auth/logout

#### **1.4 Refresh Token**
```typescript
POST /api/auth/refresh-token

// Request
{
  refreshToken: "eyJhbGc..."
}

// Response
{
  accessToken: "eyJhbGc...",
  refreshToken: "eyJhbGc..." // optional
}

// Tự động xử lý bởi API client
```


### ✅ **2. TASKS APIs**

#### **2.1 Lấy danh sách tasks**
```typescript
GET /api/tasks?page=1&pageSize=10&sortBy=createdAt&sortOrder=desc

// Cách sử dụng
const response = await tasksService.getTasks({
  page: 1,
  pageSize: 10,
  sortBy: 'createdAt',
  sortOrder: 'desc'
});

// Response
{
  tasks: [...],
  total: 50,
  page: 1,
  pageSize: 10
}
```

#### **2.2 Lấy tasks theo ngày**
```typescript
GET /api/tasks/date/:date

// Cách sử dụng
const tasks = await tasksService.getTasksByDate('2025-09-23');
```

#### **2.3 Lấy 1 task**
```typescript
GET /api/tasks/:id

// Cách sử dụng
const task = await tasksService.getTask('task-id');
```

#### **2.4 Tạo task mới**
```typescript
POST /api/tasks

// Request
{
  title: "Morning Exercise",
  date: "2025-09-23",
  duration: 30,  // minutes
  priority: "high",  // low | medium | high
  focus: "low",  // low | medium | high
  categoryId: "category-id",
  earliestStart: "05:00",
  latestEnd: "06:00",
  deadline: "2025-09-26",
  deadlineTime: "10:30",
  notes: "Remember to stretch",
  isFixed: false,
  maxSplits: 3,
  prerequisiteIds: ["task-id-1", "task-id-2"],
  imageUrl: "https://..."
}

// Cách sử dụng
const newTask = await tasksService.createTask({
  title: "Morning Exercise",
  date: "2025-09-23",
  duration: 30,
  priority: "high",
  focus: "low",
  earliestStart: "05:00",
  latestEnd: "06:00",
  isFixed: false,
  maxSplits: 3
});
```

#### **2.5 Cập nhật task**
```typescript
PUT /api/tasks/:id

// Request (tất cả fields là optional)
{
  title: "Updated Title",
  duration: 45,
  status: "completed"  // pending | scheduled | completed | dropout | unscheduled
}

// Cách sử dụng
const updated = await tasksService.updateTask('task-id', {
  title: "Updated Title",
  duration: 45
});
```

#### **2.6 Xóa task**
```typescript
DELETE /api/tasks/:id

// Cách sử dụng
await tasksService.deleteTask('task-id');
```

#### **2.7 Lấy unscheduled tasks**
```typescript
GET /api/tasks/unscheduled

// Cách sử dụng
const unscheduledTasks = await tasksService.getUnscheduledTasks();
```

#### **2.8 Lấy dropout tasks**
```typescript
GET /api/tasks/dropout

// Cách sử dụng
const dropoutTasks = await tasksService.getDropoutTasks();
```

#### **2.9 Hoàn thành task**
```typescript
PATCH /api/tasks/:id

// Cách sử dụng
await tasksService.completeTask('task-id');
```

---

### 🏷️ **3. CATEGORIES APIs**

#### **3.1 Lấy danh sách categories**
```typescript
GET /api/categories

// Cách sử dụng
const categories = await categoriesService.getCategories();

// Response
[
  {
    id: "cat-1",
    name: "Work",
    color: "blue",
    taskCount: 12,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z"
  }
]
```

#### **3.2 Lấy 1 category**
```typescript
GET /api/categories/:id

// Cách sử dụng
const category = await categoriesService.getCategory('cat-id');
```

#### **3.3 Tạo category mới**
```typescript
POST /api/categories

// Request
{
  name: "Health & Fitness",
  color: "green"
}

// Cách sử dụng
const newCategory = await categoriesService.createCategory({
  name: "Health & Fitness",
  color: "green"
});
```

#### **3.4 Cập nhật category**
```typescript
PUT /api/categories/:id

// Request
{
  name: "Updated Name",
  color: "red"
}

// Cách sử dụng
const updated = await categoriesService.updateCategory('cat-id', {
  name: "Updated Name"
});
```

#### **3.5 Xóa category**
```typescript
DELETE /api/categories/:id

// Cách sử dụng
await categoriesService.deleteCategory('cat-id');
```

---

### 🎯 **4. FOCUS BLOCKS APIs**

#### **4.1 Lấy danh sách focus blocks**
```typescript
GET /api/focus-blocks

// Cách sử dụng
const blocks = await focusBlocksService.getFocusBlocks();
```

#### **4.2 Tạo focus block mới**
```typescript
POST /api/focus-blocks

// Request
{
  name: "Deep Work",
  duration: 25,  // minutes
  color: "indigo"
}

// Cách sử dụng
const newBlock = await focusBlocksService.createFocusBlock({
  name: "Deep Work",
  duration: 25,
  color: "indigo"
});
```

#### **4.3 Cập nhật focus block**
```typescript
PUT /api/focus-blocks/:id

// Cách sử dụng
const updated = await focusBlocksService.updateFocusBlock('block-id', {
  duration: 30
});
```

#### **4.4 Xóa focus block**
```typescript
DELETE /api/focus-blocks/:id

// Cách sử dụng
await focusBlocksService.deleteFocusBlock('block-id');
```

---

### 📅 **5. SCHEDULING APIs**

#### **5.1 Lấy scheduling settings**
```typescript
GET /api/scheduling/settings

// Cách sử dụng
const settings = await schedulingService.getSettings();

// Response
{
  autoScheduling: true,
  breakBetweenTasks: true,
  breakDuration: 5,
  maxTasksPerDay: 10,
  workingHours: {
    start: "09:00",
    end: "17:00"
  },
  timezone: "UTC+7"
}
```

#### **5.2 Cập nhật scheduling settings**
```typescript
PUT /api/scheduling/settings

// Request
{
  autoScheduling: false,
  breakDuration: 10
}

// Cách sử dụng
const updated = await schedulingService.updateSettings({
  autoScheduling: false,
  breakDuration: 10
});
```

#### **5.3 Auto-schedule tasks**
```typescript
POST /api/scheduling/auto-schedule

// Request (optional)
{
  date: "2025-09-23",
  taskIds: ["task-1", "task-2"]
}

// Cách sử dụng
const result = await schedulingService.autoSchedule({
  date: "2025-09-23"
});

// Response
{
  scheduledTasks: [...],
  dropoutTasks: [...],
  unscheduledTasks: [...],
  message: "Scheduled 5 tasks successfully"
}
```

#### **5.4 Reschedule ngày**
```typescript
POST /api/scheduling/reschedule

// Request
{
  date: "2025-09-23"
}

// Cách sử dụng
const result = await schedulingService.rescheduleDay("2025-09-23");
```

---

### 👤 **6. USER APIs**

#### **6.1 Lấy user profile**
```typescript
GET /api/user/profile

// Cách sử dụng
const profile = await userService.getProfile();

// Response
{
  id: "user-id",
  email: "user@example.com",
  displayName: "John Doe",
  timezone: "UTC+7",
  avatarUrl: "https://..."
}
```

#### **6.2 Cập nhật profile**
```typescript
PUT /api/user/profile

// Request
{
  displayName: "Jane Doe",
  timezone: "UTC+8"
}

// Cách sử dụng
const updated = await userService.updateProfile({
  displayName: "Jane Doe"
});
```

#### **6.3 Lấy user settings**
```typescript
GET /api/user/settings

// Cách sử dụng
const settings = await userService.getSettings();

// Response
{
  notifications: {
    taskReminders: true,
    focusSessions: true,
    dailySummary: false,
    emailNotifications: true
  },
  appearance: {
    theme: "light",
    accentColor: "blue",
    fontSize: "medium",
    density: "comfortable"
  },
  scheduling: { ... }
}
```

#### **6.4 Cập nhật settings**
```typescript
PUT /api/user/settings

// Request
{
  notifications: {
    taskReminders: false
  }
}

// Cách sử dụng
const updated = await userService.updateSettings({
  notifications: { taskReminders: false }
});
```

#### **6.5 Đổi mật khẩu**
```typescript
POST /api/user/change-password

// Request
{
  currentPassword: "old-password",
  newPassword: "new-password"
}

// Cách sử dụng
await userService.changePassword({
  currentPassword: "old-password",
  newPassword: "new-password"
});
```

---

### 📆 **7. CALENDAR APIs**

#### **7.1 Lấy daily schedule**
```typescript
GET /api/calendar/daily/:date

// Cách sử dụng
const schedule = await calendarService.getDailySchedule("2025-09-23");

// Response
{
  date: "2025-09-23",
  tasks: [...],
  dropoutTasks: [...],
  unscheduledTasks: [...],
  totalScheduledDuration: 240,
  totalDropoutDuration: 60,
  totalUnscheduledDuration: 120
}
```

#### **7.2 Lấy weekly schedule**
```typescript
GET /api/calendar/weekly/:startDate

// Cách sử dụng
const schedule = await calendarService.getWeeklySchedule("2025-09-23");

// Response
{
  startDate: "2025-09-23",
  endDate: "2025-09-29",
  days: [...]
}
```

#### **7.3 Lấy monthly schedule**
```typescript
GET /api/calendar/monthly/:year/:month

// Cách sử dụng
const schedule = await calendarService.getMonthlySchedule(2025, 9);

// Response
{
  year: 2025,
  month: 9,
  days: [
    {
      date: "2025-09-01",
      taskCount: 5,
      hasDropout: false
    }
  ]
}
```