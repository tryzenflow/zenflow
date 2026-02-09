from concurrent import futures

import grpc
import scheduler_pb2
import scheduler_pb2_grpc
from models import EnergyZone, Event, Interval, Task, UserPreference
from scheduler import schedule_tasks

# ---- Proto → Domain Models ----


def parse_task(proto: scheduler_pb2.Task) -> Task:
    try:
        fixed_window = None
        if proto.HasField("fixed_window"):
            fixed_window = Interval(proto.fixed_window.start, proto.fixed_window.end)

        return Task(
            id=proto.id,
            title=proto.title,
            duration=proto.duration,
            fixed_window=fixed_window,
            max_splits=proto.max_splits,
            deadline=proto.deadline,
            category=proto.category_id or None,
            energy=proto.energy,
            events=[
                Event(split_index=s.split_index or 0, start=s.start, end=s.end)
                for s in proto.events
            ],
        )
    except Exception as e:
        print(f"Failed to parse task: {e}")
        raise ValueError(f"Failed to parse task: {e}")


def parse_user_preference(proto: scheduler_pb2.UserPreference) -> UserPreference:
    try:
        energy_zones = [
            EnergyZone(
                level=eb.level,
                start=eb.interval.start,
                end=eb.interval.end,
            )
            for eb in proto.energy_zones
        ]
        return UserPreference(
            break_minutes=proto.break_minutes,
            energy_zones=energy_zones,
        )
    except Exception as e:
        print(f"Failed to parse user preference: {e}")
        raise ValueError(f"Failed to parse user preference: {e}")


class SchedulerService(scheduler_pb2_grpc.SchedulerServiceServicer):
    def Schedule(self, request, context):
        # Convert proto → domain models
        tasks = [parse_task(t) for t in request.tasks]
        user_pref = parse_user_preference(request.user_preference)
        min_time = request.min_time or 0
        print("tasks:", tasks)
        print("user_pref:", user_pref)
        print("min_time:", min_time)

        try:
            schedule_result = schedule_tasks(
                tasks,
                user_pref,
                min_time=min_time,
            )
        except Exception as e:
            print(e.__class__.__name__)
            print(str(e))
            print(f"Failed to schedule tasks: {e}")
            raise ValueError(f"Failed to schedule tasks: {e}")

        # Build response
        response = scheduler_pb2.ScheduleResponse()

        for task, split_index, interval in schedule_result:
            scheduled_task = scheduler_pb2.Event()
            scheduled_task.task_id = task.id
            scheduled_task.start = interval.start
            scheduled_task.end = interval.end
            scheduled_task.split_index = split_index

            response.events.append(scheduled_task)
            print(scheduled_task)
        return response


# ---- Server Bootstrap ----


def serve():
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=10),
    )
    scheduler_pb2_grpc.add_SchedulerServiceServicer_to_server(
        SchedulerService(), server
    )
    server.add_insecure_port("[::]:50051")
    server.start()
    server.wait_for_termination()


if __name__ == "__main__":
    print("Scheduler server running on port 50051")
    serve()
