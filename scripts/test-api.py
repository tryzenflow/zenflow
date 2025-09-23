import requests

BASE_URL = "http://localhost:5000/tasks"

# Example session cookie (replace with your actual session token)
SESSION_COOKIE = {
    "connect.sid": "s:By2LedURyte7hw13DzsVZkIgFZ4t9Nyf.Zpig4Oert3NcXaDQ02uJlDWm5OGTA20VDvj2044sfhw"
}

# Map category labels in tasks → IDs from your backend
CATEGORY_MAP = {
    "work": "a5bd9f02-b81e-42e2-8f22-3e2f38e588f9",
    "study": "a5bd9f02-b81e-42e2-8f22-3e2f38e588f9",
    "health": "a1c5582b-5025-4870-a32a-9462444fc73e",
    "eat": "08db6919-008c-4e57-b27c-5a01727892fa",
    "leisure": "961c7561-0891-43cb-ad57-d6b587d95d98",
    "rest": "3a727ed9-aeaa-4e6b-bd0c-0d0d323c27cf",
    "personal": "b2d42b98-991b-470c-8a6a-030a4121bf70",
    "chores": "347740e8-47af-4df5-ae05-247104431c7b",
}


# Tasks, grouped so prerequisites are created before dependents
tasks = [
  {
    "title": "Deep Work Session",
    "duration": 120,
    "priority": 1,
    "focus": 3,
    "earliestStart": 480,
    "latestEnd": 1020,
    "mandatory": True,
    "maxSplits": 2,
    "categoryId": "a5bd9f02-b81e-42e2-8f22-3e2f38e588f9"
  },
  {
    "title": "Client Project Work",
    "duration": 180,
    "priority": 1,
    "focus": 3,
    "earliestStart": 480,
    "latestEnd": 1080,
    "mandatory": True,
    "maxSplits": 3,
    "categoryId": "a5bd9f02-b81e-42e2-8f22-3e2f38e588f9"
  },
  {
    "title": "Team Meeting",
    "duration": 60,
    "priority": 2,
    "focus": 2,
    "mandatory": True,
    "categoryId": "a5bd9f02-b81e-42e2-8f22-3e2f38e588f9"
  },
  {
    "title": "Breakfast",
    "duration": 30,
    "priority": 1,
    "focus": 1,
    "earliestStart": 360,
    "latestEnd": 600,
    "mandatory": True,
    "categoryId": "08db6919-008c-4e57-b27c-5a01727892fa"
  },
  {
    "title": "Lunch",
    "duration": 60,
    "priority": 1,
    "focus": 1,
    "earliestStart": 660,
    "latestEnd": 840,
    "mandatory": True,
    "categoryId": "08db6919-008c-4e57-b27c-5a01727892fa"
  },
  {
    "title": "Dinner",
    "duration": 60,
    "priority": 1,
    "focus": 1,
    "earliestStart": 1080,
    "latestEnd": 1260,
    "mandatory": True,
    "categoryId": "08db6919-008c-4e57-b27c-5a01727892fa"
  },
  {
    "title": "Morning Exercise",
    "duration": 45,
    "priority": 2,
    "focus": 2,
    "earliestStart": 360,
    "latestEnd": 540,
    "mandatory": False,
    "categoryId": "a1c5582b-5025-4870-a32a-9462444fc73e"
  },
  {
    "title": "Evening Exercise",
    "duration": 30,
    "priority": 2,
    "focus": 2,
    "earliestStart": 1020,
    "latestEnd": 1320,
    "mandatory": False,
    "categoryId": "a1c5582b-5025-4870-a32a-9462444fc73e"
  },
  {
    "title": "Family Time",
    "duration": 90,
    "priority": 2,
    "focus": 1,
    "earliestStart": 1020,
    "latestEnd": 1320,
    "mandatory": False,
    "categoryId": "b2d42b98-991b-470c-8a6a-030a4121bf70"
  },
  {
    "title": "Chores",
    "duration": 60,
    "priority": 3,
    "focus": 1,
    "earliestStart": 900,
    "latestEnd": 1260,
    "mandatory": False,
    "categoryId": "347740e8-47af-4df5-ae05-247104431c7b"
  },
  {
    "title": "Gaming / Leisure",
    "duration": 60,
    "priority": 3,
    "focus": 1,
    "earliestStart": 1140,
    "latestEnd": 1320,
    "mandatory": False,
    "categoryId": "961c7561-0891-43cb-ad57-d6b587d95d98"
  },
  {
    "title": "Nap",
    "duration": 30,
    "priority": 3,
    "focus": 1,
    "earliestStart": 720,
    "latestEnd": 900,
    "mandatory": False,
    "categoryId": "3a727ed9-aeaa-4e6b-bd0c-0d0d323c27cf"
  }
]

task_id_map = {}


def create_task(task: dict):
  # Map category name → categoryId
  if "category" in task:
    task["categoryId"] = CATEGORY_MAP[task["category"]]
    del task["category"]

  # Replace prerequisite titles with real IDs if available
  if "prerequisites" in task:
    resolved = []
    for prereq in task["prerequisites"]:
      if prereq in task_id_map:
        resolved.append(task_id_map[prereq])
      else:
        print(f"⚠️ Warning: prerequisite '{prereq}' not created yet.")
    task["prerequisites"] = resolved

  task['scheduleDate'] = '2025-09-21'
  response = requests.post(BASE_URL, json=task, cookies=SESSION_COOKIE)
  if response.status_code == 201:
    data = response.json()
    task_id_map[task["title"]] = data['data']["id"]  # store ID for later use
    print(f"✅ Created task '{task['title']}' with ID {data['data']["id"]}")
  else:
    print(
      f"❌ Failed to create {task['title']}: {response.status_code} {response.text}")


if __name__ == "__main__":
  for task in tasks:
    create_task(task)
