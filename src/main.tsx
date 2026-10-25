import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth';
import { I18nProvider } from './i18n';
import { AccountGate } from './account';
import App from './App';
import './theme';
import './styles.css';
import { watchTableLabels } from './tableLabels';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AccountGate>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AccountGate>
    </I18nProvider>
  </StrictMode>,
);

watchTableLabels();
