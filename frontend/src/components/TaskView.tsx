import React from 'react';

interface TaskViewProps {
  onNavigate?: (view: 'daily' | 'add-task' | 'categories' | 'focus-blocks' | 'scheduling') => void;
}

const taskCards = [
  {
    title: 'Morning Exercise',
    duration: '30 minutes',
    earliest: '5:00AM earliest',
    latest: '6:00AM latest',
    focus: 'Low Focus',
    priority: 'High Priority',
    category: 'Health & Fitness',
    schedules: ['05:00AM - 05:30AM'],
    splits: ['30 minutes'],
    image: 'https://images.unsplash.com/photo-1546484959-fcc3b8477e17?auto=format&fit=crop&w=600&q=80',
  },
  {
    title: 'Complete Client Project',
    duration: '4 hours',
    earliest: '8:00AM earliest',
    latest: '5:00PM latest',
    focus: 'High Focus',
    priority: 'High Priority',
    category: 'Work',
    schedules: ['08:00AM - 10:00AM', '02:00PM - 04:00PM'],
    splits: ['2 hours', '2 hours'],
    image: 'https://images.unsplash.com/photo-1487058792275-0ad4aaf24ca7?auto=format&fit=crop&w=600&q=80',
  },
  {
    title: 'Learn English',
    duration: '1 hour 30 minutes',
    earliest: '1:00PM earliest',
    latest: '9:00PM latest',
    focus: 'Medium Focus',
    priority: 'Medium Priority',
    category: 'Learning',
    schedules: ['07:00 - 08:00PM'],
    splits: ['1 hour'],
    image: 'https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=600&q=80',
  },
];

const dropoutTasks = [
  { name: 'Chess', duration: '1 hour' },
  { name: 'Play Badminton', duration: '2 hours' },
  { name: 'IELTS Practice Tests', duration: '30 minutes' },
];

const unscheduledTasks = [
  { name: 'Give clients presentation', duration: '45 minutes' },
  { name: 'Write Sales Report', duration: '2 hours' },
  { name: 'Build side projects', duration: '1 hour 30 minutes' },
  { name: 'House cleaning', duration: '1 hour' },
];

export function TaskView({ onNavigate }: TaskViewProps) {
  return (
    <div className="grid grid-cols-[1fr_360px] gap-10">
      <div>

        <h2 className="pb-4 text-2xl font-semibold text-gray-900">September 23, 2025</h2>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {taskCards.map((card) => (
            <div key={card.title} className="overflow-hidden rounded-[32px] border border-gray-200 bg-white shadow-modal">
              <div
                className="h-40 w-full bg-cover bg-center"
                style={{ backgroundImage: `linear-gradient(0deg, rgba(0,0,0,0.2), rgba(0,0,0,0.2)), url(${card.image})` }}
              />
              <div className="space-y-3 px-6 py-5">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{card.duration}</span>
                  <span>2 splits</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{card.earliest}</span>
                  <span>{card.latest}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-green-100 px-3 py-1 text-green-600">{card.focus}</span>
                  <span className="rounded-full bg-red-100 px-3 py-1 text-red-500">{card.priority}</span>
                  <span className="rounded-full bg-gray-900 px-3 py-1 text-white">{card.category}</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{card.title}</h3>
              </div>
              <div className="space-y-4 border-t border-gray-200 px-6 py-5 text-sm text-gray-600">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-400">Schedules</div>
                  <div className="mt-2 space-y-2 text-gray-700">
                    {card.schedules.map((schedule) => (
                      <div key={schedule} className="flex items-center justify-between rounded-2xl bg-gray-100 px-4 py-2">
                        {schedule}
                        <span className="text-gray-400">✕</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-400">Splits</div>
                  <div className="mt-2 space-y-2 text-gray-700">
                    {card.splits.map((split, index) => (
                      <div key={`${card.title}-split-${index}`} className="flex items-center justify-between rounded-2xl bg-gray-100 px-4 py-2">
                        {split}
                        <span className="text-gray-400">✕</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Upcoming days</h2>
          <div className="space-y-3 text-sm text-gray-500">
            {['September 24, 2025', 'September 25, 2025', 'September 26, 2025'].map((date) => (
              <div key={date} className="rounded-2xl border border-gray-200 px-6 py-4">{date}</div>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-8">
        <section className="space-y-3">
          <div className="flex items-center justify-between text-sm font-semibold text-gray-500">
            <span>September 2025</span>
            <span className="text-gray-400">&gt;</span>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-xs text-gray-400">
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map((day) => (
              <div key={day}>{day}</div>
            ))}
            {Array.from({ length: 30 }).map((_, index) => (
              <div
                key={index}
                className={`flex h-8 items-center justify-center rounded-full ${index === 14 ? 'bg-black text-white' : 'text-gray-600'}`}
              >
                {index + 1}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>Dropout Tasks</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">3</span>
          </div>
          <div className="space-y-3 text-sm text-gray-600">
            {dropoutTasks.map((task) => (
              <div key={task.name} className="flex items-center justify-between rounded-2xl border border-gray-200 px-5 py-3">
                <div>
                  <div>{task.name}</div>
                  <div className="text-xs text-gray-400">{task.duration}</div>
                </div>
                <span className="text-gray-400">✕</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>Unscheduled Tasks</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-300 text-[10px] text-gray-700">4</span>
          </div>
          <div className="space-y-3 text-sm text-gray-600">
            {unscheduledTasks.map((task) => (
              <label key={task.name} className="flex items-center gap-3 rounded-2xl border border-gray-200 px-5 py-3">
                <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                <div>
                  <div>{task.name}</div>
                  <div className="text-xs text-gray-400">{task.duration}</div>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 px-5 py-4 text-xs text-gray-500">
          <div className="font-medium text-gray-900">Infeasible Schedule</div>
          <p className="mt-2">Task Play Badminton is dropped due to infeasible schedule</p>
          <button className="mt-3 rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700">Edit Task</button>
        </section>
      </aside>
    </div>
  );
}

