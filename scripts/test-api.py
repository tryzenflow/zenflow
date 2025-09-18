import requests

BASE_URL = "http://localhost:5000/tasks"

# Example session cookie (replace with your actual session token)
SESSION_COOKIE = {
    "connect.sid": "s:sEJM_GM0KL1SwzYDxBcOPS3TJqFxc4yv.R49wv8frjWkupTZK13xDwkbtyCwOHx7ecd%2Bo179TPsA"
}

# Map category labels in tasks → IDs from your backend
CATEGORY_MAP = {
    "work": "4b296854-4613-4f9f-ae47-fa9904920480",
    "study": "4b296854-4613-4f9f-ae47-fa9904920480",
    "health": "2661e6a3-6b20-48dc-889d-585479ba2b79",
    "eat": "075019ad-ad9b-4a04-806f-3422ac528193",
    "leisure": "0d1a8431-1606-43f1-9dfc-d49442f479db",
    "rest": "589d8495-697c-439f-9b4e-c06710ca61f3",
    "personal": "343826f0-c18a-49b8-8766-3136d3b9aa97",
    "chores": "d65cb738-5d72-4979-b5a1-d56ea7f5ba9f",
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
