from concurrent import futures

import grpc
import scheduler_pb2
import scheduler_pb2_grpc
from models import EnergyBlock, Interval, ScheduledBlock, Task, UserPreference
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
            preferred_windows=[
                Interval(w.start, w.end) for w in proto.preferred_windows
            ],
            deadline=proto.deadline,
            category=proto.category_id or None,
            energy=proto.energy,
            scheduled_blocks=[
                ScheduledBlock(split_index=s.split_index or 0, start=s.start, end=s.end)
                for s in proto.scheduled_blocks
            ],
        )
    except Exception as e:
        print(f"Failed to parse task: {e}")
        raise ValueError(f"Failed to parse task: {e}")


def parse_user_preference(proto: scheduler_pb2.UserPreference) -> UserPreference:
    try:
        energy_blocks = [
            EnergyBlock(
                energy=eb.energy,
                start=eb.interval.start,
                end=eb.interval.end,
            )
            for eb in proto.energy_blocks
        ]
        return UserPreference(
            min_gap_between_tasks=proto.min_gap_between_tasks,
            energy_blocks=energy_blocks,
        )
    except Exception as e:
        print(f"Failed to parse user preference: {e}")
        raise ValueError(f"Failed to parse user preference: {e}")


class SchedulerService(scheduler_pb2_grpc.SchedulerServiceServicer):
    def Schedule(self, request, context):
        # Convert proto → domain models
        tasks = [parse_task(t) for t in request.tasks]
        user_pref = parse_user_preference(request.user_preference)

        try:
            schedule_result = schedule_tasks(
                tasks,
                user_pref,
            )
        except Exception as e:
            print(f"Failed to schedule tasks: {e}")
            raise ValueError(f"Failed to schedule tasks: {e}")

        # Build response
        response = scheduler_pb2.ScheduleResponse()

        for task, split_index, interval in schedule_result:
            scheduled_task = scheduler_pb2.ScheduledBlock()
            scheduled_task.task_id = task.id
            scheduled_task.start = interval.start
            scheduled_task.end = interval.end
            scheduled_task.split_index = split_index

            response.scheduled_blocks.append(scheduled_task)
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
