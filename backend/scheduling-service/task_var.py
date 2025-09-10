from ortools.sat.python import cp_model
from models import Task


class TaskVar:
  def __init__(self, task: Task, split: int, start: cp_model.IntVar, end: cp_model.IntVar, presence: cp_model.BoolVarT) -> None:
    self.task = task
    self.split = split
    self.start = start
    self.end = end
    self.presence = presence

  @property
  def tuple(self):
    return self.task, self.split, self.start, self.end, self.presence
