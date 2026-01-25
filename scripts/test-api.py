import requests

BASE_URL = "http://localhost:5000/tasks"

# Example session cookie (replace with your actual session token)
SESSION_COOKIE = {
    "connect.sid": "s%3A60atQxFdExJhBuJcLCrub72i5w86mtAH.STff3kfXfjns2LhzGj5nB%2BhNA7WVOPcsmoq2Wxc707I"
}

categories = [
    {
        "id": "7d19f4b7-dfeb-4c07-9762-2952bbffcf82",
        "name": "💼 Deep Work",
        "userId": "91da7b4f-d18b-42e8-a897-785295687069",
        "order": 0,
    },
    {
        "id": "288b46d2-7e01-46dd-9cf2-44ccb352e041",
        "name": "🧠 Shallow / Admin",
        "userId": "91da7b4f-d18b-42e8-a897-785295687069",
        "order": 4096,
    },
    {
        "id": "ecc6904d-6175-4326-9e9b-b587a2f80163",
        "name": "📞 Meetings & Calls",
        "userId": "91da7b4f-d18b-42e8-a897-785295687069",
        "order": 8192,
    },
    {
        "id": "d2319887-05b1-4675-b358-b9fe50c30b60",
        "name": "✍️ Writing & Communication",
        "userId": "91da7b4f-d18b-42e8-a897-785295687069",
        "order": 12288,
    },
    {
        "id": "77354bb5-09f4-41af-af64-1ac86e87ea56",
        "name": "📚 Learning & Research",
        "userId": "91da7b4f-d18b-42e8-a897-785295687069",
        "order": 16384,
    },
    {
        "id": "809937a9-45c7-4c23-b7d7-5eb784f3d672",
        "name": "🚀 Projects & Planning",
        "userId": "91da7b4f-d18b-42e8-a897-785295687069",
        "order": 20480,
    },
    {
        "id": "c09d8c94-62b7-442e-b065-bc9ab3bee263",
        "name": "🧪 Experiments & Side Work",
        "userId": "91da7b4f-d18b-42e8-a897-785295687069",
        "order": 24576,
    },
]

# --- Helper for ISO8601 deadlines ---
# --- Tasks ---
tasks = [
    {
        "title": "Client Project",
        "duration": 300,
        "energy": 3,
        "deadline": "2026-01-10T23:59:59Z",
        "categoryId": "7d19f4b7-dfeb-4c07-9762-2952bbffcf82",
        "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    },
    {
        "title": "Write Documentation",
        "duration": 60,
        "energy": 2,
        "categoryId": "d2319887-05b1-4675-b358-b9fe50c30b60",
    },
    {
        "title": "Personal Project",
        "duration": 120,
        "energy": 2,
        "deadline": "2026-02-15T23:59:59Z",
        "categoryId": "c09d8c94-62b7-442e-b065-bc9ab3bee263",
        "preferredWindows": [{"start": 19 * 60, "end": 23 * 60}],
        "rrule": "FREQ=DAILY",
    },
    {
        "title": "Daily Standup",
        "duration": 60,
        "energy": 1,
        "categoryId": "ecc6904d-6175-4326-9e9b-b587a2f80163",
        "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        "fixedWindow": {"start": 9 * 60, "end": 10 * 60},
    },
    {
        "title": "Learn Kafka",
        "duration": 90,
        "energy": 2,
        "categoryId": "77354bb5-09f4-41af-af64-1ac86e87ea56",
        "preferredWindows": [{"start": 19 * 60, "end": 23 * 60}],
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
