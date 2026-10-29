import { Routes, Route, NavLink } from 'react-router-dom';
import TasksPage from './pages/TasksPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ErrorsPage from './pages/ErrorsPage.jsx';
import { ErrorProvider } from './context/ErrorContext.jsx';
import Footer from './components/Footer.jsx';

export default function App() {
  return (
    <ErrorProvider>
      <div className="app">
        <header className="header">
          <h1>BBB MP4 Panel</h1>
          <nav className="nav">
            <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')}>Задачи</NavLink>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>Настройки</NavLink>
            <NavLink to="/errors" className={({ isActive }) => (isActive ? 'active' : '')}>Ошибки</NavLink>
          </nav>
        </header>
        <Routes>
          <Route path="/" element={<TasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/errors" element={<ErrorsPage />} />
        </Routes>
        <Footer />
      </div>
    </ErrorProvider>
  );
}
