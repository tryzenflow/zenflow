import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import type { NavigationView } from '../types/navigation';

interface MainLayoutProps {
  currentView: NavigationView;
  onNavigate: (view: NavigationView) => void;
  children: React.ReactNode;
}

export function MainLayout({ currentView, onNavigate, children }: MainLayoutProps) {
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      {/* Top Header Bar */}
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-sm text-gray-400">September 22, 2025</div>
            <div className="text-lg font-semibold text-gray-900">Monday</div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Today
            </button>
            <button 
              className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <div className="ml-4 flex items-center gap-2">
              <button 
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => onNavigate(currentView === 'daily' ? 'tasks' : 'daily')}
              >
                {currentView === 'daily' ? 'Task view' : 'Day view'}
              </button>
              
              {(currentView === 'daily' || currentView === 'tasks') && (
                <>
                  <button 
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => onNavigate('scheduling')}
                  >
                    Schedule
                  </button>

                  <div className="relative">
                    <button 
                      className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
                      onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                      aria-label="Settings"
                    >
                      <Settings className="h-4 w-4" />
                    </button>

                    {showSettingsMenu && (
                      <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
                        <div className="py-1">
                          <button
                            className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            onClick={() => {
                              onNavigate('categories');
                              setShowSettingsMenu(false);
                            }}
                          >
                            Categories Settings
                          </button>
                          <button
                            className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            onClick={() => {
                              onNavigate('focus-blocks');
                              setShowSettingsMenu(false);
                            }}
                          >
                            Focus Blocks Settings
                          </button>
                          <button
                            className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            onClick={() => {
                              onNavigate('scheduling');
                              setShowSettingsMenu(false);
                            }}
                          >
                            Scheduling Styles
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <button 
                className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90"
                onClick={() => onNavigate('add-task')}
              >
                Add task
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {children}
      </main>
    </div>
  );
}

