from datetime import datetime, timedelta, timezone

import requests

BASE_URL = "http://localhost:5000/tasks"

# Example session cookie (replace with your actual session token)
SESSION_COOKIE = {
    "connect.sid": "s:XsuzvxYf1npleNlVsrGoGNqY90s9zae7.uE1JU0N4p7DEqUwkC/ikWo1YXJi0iZlFJOhxT6/GWsQ"
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


# --- Categories ---
categories = [
    {"id": "28a69b84-66c2-4cd9-b924-1430378b2855", "name": "🧠 Personal"},
    {"id": "ee63364e-ae9e-4b44-806f-037e98716a34", "name": "💼 Work"},
    {"id": "be60c95c-2e08-4aed-9ff8-4be9101ea977", "name": "📚 Study & Learning"},
    {"id": "ccbc41dd-9458-4683-aba1-0df4d2472f7c", "name": "🏠 Home & Chores"},
    {"id": "2a1fc79f-60bc-45d4-914c-fd095ea7e287", "name": "💪 Health & Fitness"},
    {"id": "55e23d8a-9ac3-4f8d-a4aa-01d060a3f53f", "name": "🛒 Errands & Shopping"},
    {"id": "71ec6d8b-823a-4444-8829-f758539dfc8b", "name": "👨‍👩‍👧 Family"},
    {"id": "6e00bb4a-4208-4763-a965-264458d083d9", "name": "📅 Planning"},
]


# --- Helper for ISO8601 deadlines ---
def get_deadline(hours_from_now):
    return (datetime.now(timezone.utc) + timedelta(hours=hours_from_now)).replace(
        tzinfo=None
    ).isoformat(timespec="seconds") + "Z"


print("Deadline:", get_deadline(24))

# --- Tasks ---
tasks = [
    {
        "title": "Deep Work: Project Report",
        "duration": 180,
        "priority": 3,
        "energy": 3,
        "deadline": "2026-01-02T18:00:00Z",
        "categoryId": "ee63364e-ae9e-4b44-806f-037e98716a34",
    },
    {
        "title": "Breakfast",
        "duration": 45,
        "priority": 1,
        "energy": 1,
        "preferredWindows": [{"start": 360, "end": 480}],
        "categoryId": "28a69b84-66c2-4cd9-b924-1430378b2855",
    },
    {
        "title": "Focused Study Session",
        "duration": 120,
        "priority": 2,
        "energy": 2,
        "rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=3",
        "categoryId": "be60c95c-2e08-4aed-9ff8-4be9101ea977",
    },
    {
        "title": "Lunch Break",
        "duration": 75,
        "priority": 1,
        "energy": 1,
        "categoryId": "28a69b84-66c2-4cd9-b924-1430378b2855",
    },
    {
        "title": "Grocery Shopping",
        "duration": 90,
        "priority": 2,
        "energy": 1,
        "categoryId": "55e23d8a-9ac3-4f8d-a4aa-01d060a3f53f",
    },
    {
        "title": "Team Sync Meeting",
        "duration": 90,
        "priority": 3,
        "energy": 2,
        "fixedWindow": {"start": 600, "end": 720},
        "categoryId": "ee63364e-ae9e-4b44-806f-037e98716a34",
    },
    {
        "title": "Morning Strength Workout",
        "duration": 90,
        "priority": 2,
        "energy": 3,
        "fixedWindow": {"start": 360, "end": 480},
        "rrule": "FREQ=DAILY;COUNT=5",
        "categoryId": "2a1fc79f-60bc-45d4-914c-fd095ea7e287",
    },
    {
        "title": "Evening Walk",
        "duration": 60,
        "priority": 1,
        "energy": 1,
        "categoryId": "28a69b84-66c2-4cd9-b924-1430378b2855",
    },
    {
        "title": "Dinner with Family",
        "duration": 90,
        "priority": 2,
        "energy": 1,
        "preferredWindows": [{"start": 1080, "end": 1260}],
        "categoryId": "71ec6d8b-823a-4444-8829-f758539dfc8b",
    },
    {
        "title": "Daily Review & Planning",
        "duration": 60,
        "priority": 1,
        "energy": 1,
        "preferredWindows": [{"start": 1260, "end": 1380}],
        "categoryId": "6e00bb4a-4208-4763-a965-264458d083d9",
    },
]


def create_task(task: dict):
    response = requests.post(BASE_URL, json=task, cookies=SESSION_COOKIE)
    if response.status_code == 201:
        data = response.json()
        print(f"✅ Created task '{task['title']}' with ID {data['data']['id']}")
    else:
        print(
            f"❌ Failed to create {task['title']}: {response.status_code} {response.text}"
        )


if __name__ == "__main__":
    for task in tasks:
        create_task(task)

[
    "f8240962-b1f3-4282-ad42-db87a087544a",
    "a035caf5-01bc-48aa-87ee-cdb65a83aafe",
    "bd7214f2-5da7-47b6-9a84-ec798607080e",
    "ec9079f8-5f8d-4e83-8f3c-ee26ff6d2e1c",
    "7e6c45ba-ba46-408f-8e88-bba79e148ca9",
    "e50ead9f-08f1-4a57-9661-02d7de837d63",
    "9894c8eb-2079-40ec-afc8-ae7c1cb54c59",
    "c2e20dbe-8d83-42c5-8efe-99d175f83f17",
    "1bfb277b-691a-47a1-9c61-aa035d81e874",
    "c3bb9a67-5afc-4be1-b1fc-97fbe9bd3a95",
]
