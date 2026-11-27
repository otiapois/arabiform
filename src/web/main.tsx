import { createRoot } from 'react-dom/client';
import { App } from './App';
import { translator } from './labels';
import './styles.css';

const root = document.querySelector('#root')!;
const route = root.querySelector('[data-route-content]');
const details = route?.querySelector('[data-route-details]');
const arabic = location.pathname.replace(/\/$/, '') === '/ar/pdf-mail-merge';
const language: ReturnType<typeof translator> = import.meta.env.DEV ? translator(arabic) : {
  arabic,
  labels: JSON.parse(root.querySelector<HTMLScriptElement>('[data-workbench-labels]')!.text),
};
document.documentElement.lang = arabic ? 'ar' : 'en';
document.documentElement.dir = arabic ? 'rtl' : 'ltr';

createRoot(root).render(
  <App
    language={language}
    heading={route?.querySelector('h1')?.textContent?.trim()}
    summary={route?.querySelector('[data-route-summary]')?.textContent?.trim()}
    details={details ? { __html: details.innerHTML } : undefined}
  />,
);
