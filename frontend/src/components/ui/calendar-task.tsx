import React from 'react';

interface CalendarTaskProps {
  time: string;
  title: string;
  color: 'yellow' | 'green' | 'red';
  width?: string;
  height?: string;
  className?: string;
}

export function CalendarTask({ time, title, color, width = 'w-[260px]', height = 'h-12', className = '' }: CalendarTaskProps) {
  const colorStyles = {
    yellow: {
      wrapper: 'bg-yellow-100 text-yellow-900',
      time: 'text-yellow-500'
    },
    green: {
      wrapper: 'bg-green-100 text-green-900',
      time: 'text-green-500'
    },
    red: {
      wrapper: 'bg-red-100 text-red-600',
      time: 'text-red-500'
    }
  };

  return (
    <div className={`${width} ${height} rounded-2xl ${colorStyles[color].wrapper} px-4 py-2 text-xs font-medium shadow-sm ${className}`}>
      <div className={`text-[11px] uppercase ${colorStyles[color].time}`}>{time}</div>
      {title}
    </div>
  );
}