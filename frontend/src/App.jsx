import { Routes, Route, NavLink } from 'react-router-dom';
import TasksPage from './pages/TasksPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>BBB MP4 Panel</h1>
        <nav className="nav">
          <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')}>Задачи</NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>Настройки</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<TasksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}
