from concurrent import futures
import grpc
import scheduler_pb2
import scheduler_pb2_grpc

from google.protobuf.timestamp_pb2 import Timestamp
from models import Task, Interval, FocusBlock, Constraints
from scheduler import schedule_tasks


# ---- Proto → Domain Models ----

def parse_task(task_proto: scheduler_pb2.Task) -> Task:
  deadline: Timestamp | None = task_proto.deadline

  return Task(
      id=task_proto.id,
      title=task_proto.title,
      duration=task_proto.duration,
      priority=task_proto.priority or 3,
      earliest_start=task_proto.earliest_start if task_proto.earliest_start else None,
      latest_end=task_proto.latest_end if task_proto.latest_end else None,
      deadline=deadline.ToDatetime() if deadline else None,
      mandatory=task_proto.mandatory,
      max_splits=task_proto.max_splits or 1,
      category=task_proto.category_id if task_proto.category_id else None,
      prerequisites=list(task_proto.prerequisites),
      focus=task_proto.focus or 1,
  )


def parse_constraints(c_proto: scheduler_pb2.Constraints) -> Constraints:
  available_hours = [Interval(a.start, a.end) for a in c_proto.available_hours]
  focus_blocks = [
      FocusBlock(
          level=fb.level,
          interval=Interval(fb.interval.start, fb.interval.end),
      )
      for fb in c_proto.focus_blocks
  ]
  return Constraints(
      available_hours=available_hours,
      min_gap_between_tasks=c_proto.min_gap_between_tasks,
      focus_blocks=focus_blocks,
      batch_similar_tasks=c_proto.batch_similar_tasks,
      max_daily_load=c_proto.max_daily_load,
  )


class SchedulerService(scheduler_pb2_grpc.SchedulerServiceServicer):
  def Schedule(self, request, context):
    # Convert proto → domain models
    tasks = [parse_task(t) for t in request.tasks]
    constraints = parse_constraints(request.constraints)
    schedule_result = schedule_tasks(tasks, constraints)
    # Build response
    response = scheduler_pb2.ScheduleResponse()
    for task, split, interval in schedule_result:
      scheduled_task = scheduler_pb2.TaskSchedule()
      scheduled_task.task_id = task.id
      scheduled_task.start = interval.start
      scheduled_task.end = interval.end
      scheduled_task.split = split

      response.schedules.append(scheduled_task)

    return response


# ---- Server Bootstrap ----

def serve():
  server = grpc.server(futures.ThreadPoolExecutor(max_workers=10), options=[
      ("grpc.max_receive_message_length", 5 * 1024 * 1024),
      ("grpc.max_send_message_length", 5 * 1024 * 1024),
  ])
  scheduler_pb2_grpc.add_SchedulerServiceServicer_to_server(
      SchedulerService(), server
  )
  server.add_insecure_port("[::]:50051")
  server.start()
  server.wait_for_termination()


if __name__ == "__main__":
  print("Scheduler server running on port 50051")
  serve()
