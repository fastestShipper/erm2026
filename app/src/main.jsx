import { createRoot } from 'react-dom/client';
import './theme.css';
import { DataProvider } from './lib/data.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <DataProvider><App /></DataProvider>,
);
