import './styles/app.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './app/router';
import { TooltipProvider } from './design/Tooltip';
import { queryClient } from './state/queries';
import { applyTheme, useSession, watchSystemTheme } from './state/session';

const { theme, density } = useSession.getState();
applyTheme(theme);
document.documentElement.dataset.density = density;
watchSystemTheme();

const root = document.getElementById('root');
if (!root) throw new Error('The #root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
