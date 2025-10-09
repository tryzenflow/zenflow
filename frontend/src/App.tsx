import React, { useState } from 'react';
import './App.css';
import { LoginScreen } from './components/LoginScreen';
import { MainLayout } from './components/MainLayout';
import { DailyView } from './components/DailyView';
import { TaskView } from './components/TaskView';
import { AddTaskView } from './components/AddTaskView';
import { CategoriesModal } from './components/CategoriesModal';
import { FocusBlocksModal } from './components/FocusBlocksModal';
import { SchedulingModal } from './components/SchedulingModal';
import type { NavigationView } from './types/navigation';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentView, setCurrentView] = useState<NavigationView>('daily');

  const handleLoginSuccess = () => {
    setIsLoggedIn(true);
  };

  if (!isLoggedIn) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  const renderCurrentView = () => {
    switch (currentView) {
      case 'daily':
        return <DailyView onNavigate={setCurrentView} />;
      case 'tasks':
        return <TaskView onNavigate={setCurrentView} />;
      default:
        return <DailyView onNavigate={setCurrentView} />;
    }
  };

  return (
    <>
      <MainLayout currentView={currentView} onNavigate={setCurrentView}>
        {renderCurrentView()}
      </MainLayout>
      {currentView === 'add-task' && (
        <AddTaskView onClose={() => setCurrentView('daily')} />
      )}
      {currentView === 'categories' && (
        <CategoriesModal onClose={() => setCurrentView('daily')} />
      )}
      {currentView === 'focus-blocks' && (
        <FocusBlocksModal onClose={() => setCurrentView('daily')} />
      )}
      {currentView === 'scheduling' && (
        <SchedulingModal onClose={() => setCurrentView('daily')} />
      )}
    </>
  );
}

export default App;
