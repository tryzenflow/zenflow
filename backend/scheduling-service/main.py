from concurrent import futures

import grpc
import scheduler_pb2
import scheduler_pb2_grpc
from models import EnergyBlock, Interval, ScheduledBlock, Task, UserPreference
from scheduler import schedule_tasks

# ---- Proto → Domain Models ----


def parse_task(proto: scheduler_pb2.Task) -> Task:
    deadline = None
    if proto.HasField("deadline"):
        dt = proto.deadline.ToDatetime()
        # ignore "epoch" timestamps
        if dt.year > 1970:
            deadline = dt

    return Task(
        id=proto.id,
        title=proto.title,
        duration=proto.duration,
        priority=proto.priority,
        deadline=deadline.ToDatetime() if deadline else None,
        category=proto.category_id if proto.category_id else None,
        energy=proto.energy,
        scheduled_blocks=[
            ScheduledBlock(split_index=s.split_index or 0, start=s.start, end=s.end)
            for s in proto.scheduled_blocks
        ],
    )


def parse_user_preference(proto: scheduler_pb2.UserPreference) -> UserPreference:
    available_hours = [Interval(a.start, a.end) for a in proto.available_hours]
    energy_blocks = [
        EnergyBlock(
            energy=eb.energy,
            start=eb.interval.start,
            end=eb.interval.end,
        )
        for eb in proto.energy_blocks
    ]
    return UserPreference(
        available_hours=available_hours,
        min_gap_between_tasks=proto.min_gap_between_tasks,
        energy_blocks=energy_blocks,
    )


class SchedulerService(scheduler_pb2_grpc.SchedulerServiceServicer):
    def Schedule(self, request, context):
        # Convert proto → domain models
        tasks = [parse_task(t) for t in request.tasks]
        user_pref = parse_user_preference(request.user_preference)
        schedule_result = schedule_tasks(
            tasks,
            user_pref,
        )
        # Build response
        response = scheduler_pb2.SchedulerResponse()

        for task, split_index, interval in schedule_result:
            scheduled_task = scheduler_pb2.ScheduledBlock()
            scheduled_task.task_id = task.id
            scheduled_task.start = interval.start
            scheduled_task.end = interval.end
            scheduled_task.split_index = split_index

            response.schedules.append(scheduled_task)
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
