import requests

BASE_URL = "http://localhost:5000/tasks"

# Example session cookie (replace with your actual session token)
SESSION_COOKIE = {
    "connect.sid": "s:a7bBc6nZN2UtnGWFyNWQgvld1UFaF3sk.P1sASqX2h5sL3hVF7BXGN%2BbT%2BbagyUneEt9PJuiwhjE"
}

# Map category labels in tasks → IDs from your backend
CATEGORY_MAP = {
    "work": "9aa3a6f2-ab1a-4f28-a97f-01472a7b996e",
    "study": "9aa3a6f2-ab1a-4f28-a97f-01472a7b996e",
    "health": "6dee747a-bde8-4bfe-86ad-bcf28764ce84",
    "eat": "dfb6d435-bcf9-46aa-981b-3ee6130af820",
    "leisure": "9af9d773-b7bd-4d6e-b4f5-ea122786c36b",
    "rest": "c28b1bef-0df6-4204-8de6-03e6b0250fdf",
    "personal": "f8cb590c-f25c-4e70-9528-eabb65512235",
    "chores": "6f9da2ab-c384-4b15-aae2-0708212833f1",
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
        "energyLevel": 3,
        "mandatory": False,
    },
    {
        "title": "Complete client projects",
        "duration": 240,
        "priority": 1,
        "earliestStart": 8 * 60,
        "latestEnd": 17 * 60,
        "splittable": True,
        "maxSplits": 2,
        "energyLevel": 3,
        "category": "work",
    },
    {
        "title": "Read book",
        "duration": 60,
        "priority": 3,
        "mandatory": False,
        "earliestStart": 19 * 60,
        "latestEnd": 22 * 60,
        "energyLevel": 2,
        "category": "leisure",
    },
    {
        "title": "Team Meeting",
        "duration": 60,
        "priority": 1,
        "fixedStart": 9 * 60 + 30,
        "mandatory": True,
        "energyLevel": 2,
        "category": "work",
    },
    {
        "title": "Lunch",
        "duration": 60,
        "priority": 2,
        "earliestStart": 11 * 60,
        "latestEnd": 13 * 60,
        "energyLevel": 1,
        "category": "eat",
    },

    # Morning exercise → Breakfast
    {
        "title": "Morning Exercise",
        "duration": 30,
        "priority": 1,
        "earliestStart": 6 * 60,
        "latestEnd": 8 * 60,
        "energyLevel": 1,
        "category": "health",
    },
    {
        "title": "Breakfast",
        "duration": 60,
        "priority": 1,
        "earliestStart": 6 * 60,
        "latestEnd": 8 * 60,
        "energyLevel": 1,
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
        "energyLevel": 1,
        "category": "health",
    },
    {
        "title": "Dinner",
        "duration": 60,
        "priority": 2,
        "earliestStart": 17 * 60,
        "latestEnd": 19 * 60,
        "energyLevel": 1,
        "category": "eat",
        "prerequisites": ["Evening Exercise"],
    },

    {
        "title": "Shower",
        "duration": 15,
        "priority": 3,
        "earliestStart": 13 * 60,
        "latestEnd": 15 * 60,
        "energyLevel": 1,
        "category": "health",
    },
    {
        "title": "Nap",
        "duration": 15,
        "priority": 2,
        "mandatory": False,
        "earliestStart": 12 * 60,
        "latestEnd": 14 * 60,
        "energyLevel": 1,
        "category": "rest",
    },
    {
        "title": "Learn English",
        "duration": 60,
        "priority": 2,
        "mandatory": False,
        "energyLevel": 2,
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
