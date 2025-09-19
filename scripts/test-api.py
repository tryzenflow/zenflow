import requests

BASE_URL = "http://localhost:5000/tasks"

# Example session cookie (replace with your actual session token)
SESSION_COOKIE = {
    "connect.sid": "s:Vr60AayUMK-k5z8n75djcuJX7TDflfIs.kamA7PKaX%2FZhRnMH23mLlvBrVYmKNE9vOYluWHZcJA8"
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
        "title": "Chess",
        "duration": 60,
        "priority": 3,
        "category": "leisure",
        "earliestStart": 19 * 60,
        "latestEnd": 22 * 60,
        "focus": 3,
        "mandatory": False,
    },
    {
        "title": "Complete client projects",
        "duration": 240,
        "priority": 1,
        "earliestStart": 8 * 60,
        "latestEnd": 17 * 60,
        "maxSplits": 2,
        "focus": 3,
        "category": "work",
    },
    {
        "title": "Read book",
        "duration": 60,
        "priority": 3,
        "mandatory": False,
        "earliestStart": 19 * 60,
        "latestEnd": 22 * 60,
        "focus": 2,
        "category": "leisure",
    },
    {
        "title": "Team Meeting",
        "duration": 60,
        "priority": 1,
        "mandatory": True,
        "focus": 2,
        "category": "work",
    },
    {
        "title": "Lunch",
        "duration": 60,
        "priority": 2,
        "earliestStart": 11 * 60,
        "latestEnd": 13 * 60,
        "focus": 1,
        "category": "eat",
    },

    # Morning exercise → Breakfast
    {
        "title": "Morning Exercise",
        "duration": 30,
        "priority": 1,
        "earliestStart": 6 * 60,
        "latestEnd": 8 * 60,
        "focus": 1,
        "category": "health",
    },
    {
        "title": "Breakfast",
        "duration": 60,
        "priority": 1,
        "earliestStart": 6 * 60,
        "latestEnd": 8 * 60,
        "focus": 1,
        "category": "eat",
        "prerequisites": ["Morning Exercise"],
    },

    # Evening exercise → Dinner
    {
        "title": "Evening Exercise",
        "duration": 30,
        "priority": 3,
        "earliestStart": 17 * 60,
        "latestEnd": 19 * 60,
        "focus": 1,
        "category": "health",
    },
    {
        "title": "Dinner",
        "duration": 60,
        "priority": 2,
        "earliestStart": 17 * 60,
        "latestEnd": 19 * 60,
        "focus": 1,
        "category": "eat",
        "prerequisites": ["Evening Exercise"],
    },

    {
        "title": "Shower",
        "duration": 15,
        "priority": 3,
        "earliestStart": 13 * 60,
        "latestEnd": 15 * 60,
        "focus": 1,
        "category": "health",
    },
    {
        "title": "Nap",
        "duration": 15,
        "priority": 2,
        "mandatory": False,
        "earliestStart": 12 * 60,
        "latestEnd": 14 * 60,
        "focus": 1,
        "category": "rest",
    },
    {
        "title": "Learn English",
        "duration": 60,
        "priority": 2,
        "mandatory": False,
        "focus": 2,
        "category": "study",
    },
]

# Map to track task title → ID from API response
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

  response = requests.post(BASE_URL, json=task, cookies=SESSION_COOKIE)
  if response.status_code == 201:
    data = response.json()
    task_id_map[task["title"]] = data["id"]  # store ID for later use
    print(f"✅ Created task '{task['title']}' with ID {data['id']}")
  else:
    print(
      f"❌ Failed to create {task['title']}: {response.status_code} {response.text}")


if __name__ == "__main__":
  for task in tasks:
    create_task(task)
