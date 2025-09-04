from concurrent import futures
import grpc
import scheduler_pb2
import scheduler_pb2_grpc

from models import Task, Interval, EnergyBlock, Constraints
from scheduler import schedule_tasks


# ---- Proto → Domain Models ----

def parse_task(task_proto: scheduler_pb2.Task) -> Task:
  return Task(
      id=task_proto.id if task_proto.id else None,
      title=task_proto.title,
      duration=task_proto.duration,
      priority=task_proto.priority or 3,
      fixed_start=task_proto.fixed_start if task_proto.fixed_start else None,
      earliest_start=task_proto.earliest_start if task_proto.earliest_start else None,
      latest_end=task_proto.latest_end if task_proto.latest_end else None,
      deadline=task_proto.deadline if task_proto.deadline else None,
      mandatory=task_proto.mandatory,
      splittable=task_proto.splittable,
      max_splits=task_proto.max_splits or 1,
      category=task_proto.category if task_proto.category else None,
      prerequisites=list(task_proto.prerequisites),
      energy_level=task_proto.energy_level or 1,
  )


def parse_constraints(c_proto: scheduler_pb2.Constraints) -> Constraints:
  available_hours = [Interval(a.start, a.end) for a in c_proto.available_hours]
  energy_blocks = [
      EnergyBlock(
          energy_level=eb.energy_level,
          interval=Interval(eb.interval.start, eb.interval.end),
      )
      for eb in c_proto.energy_blocks
  ]
  return Constraints(
      available_hours=available_hours,
      min_gap_between_tasks=c_proto.min_gap_between_tasks,
      energy_blocks=energy_blocks,
      batch_similar_tasks=c_proto.batch_similar_tasks,
      max_daily_load=c_proto.max_daily_load,
  )


class SchedulerService(scheduler_pb2_grpc.SchedulerServiceServicer):
  def schedule(self, request, context):
    # Convert proto → domain models
    tasks = [parse_task(t) for t in request.tasks]
    constraints = parse_constraints(request.constraints)

    # Call your solver
    schedule_result = schedule_tasks(tasks, constraints)

    # Build response
    response = scheduler_pb2.ScheduleResponse()
    for task, interval in schedule_result:
      scheduled_task = scheduler_pb2.ScheduledTask()
      scheduled_task.task.id = task.id
      scheduled_task.task.title = task.title
      scheduled_task.task.duration = task.duration
      scheduled_task.task.priority = task.priority
      scheduled_task.task.fixed_start = task.fixed_start or 0
      scheduled_task.task.earliest_start = task.earliest_start or 0
      scheduled_task.task.latest_end = task.latest_end or 0
      scheduled_task.task.deadline = task.deadline or 0
      scheduled_task.task.mandatory = task.mandatory
      scheduled_task.task.splittable = task.splittable
      scheduled_task.task.max_splits = task.max_splits
      scheduled_task.task.category = task.category or ""
      scheduled_task.task.prerequisites.extend(task.prerequisites)
      scheduled_task.task.energy_level = task.energy_level

      scheduled_task.slot.start = interval.start
      scheduled_task.slot.end = interval.end

      response.schedule.append(scheduled_task)

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
