import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import 'pdfjs-dist/web/pdf_viewer.css';
import './index.css';
import { Layout } from './components/Layout';
import { DictionaryPage } from './pages/DictionaryPage';
import { DocumentPage } from './pages/DocumentPage';
import { ItemPage } from './pages/ItemPage';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LibraryPage /> },
      { path: '/item/:id', element: <ItemPage /> },
      { path: '/document/:id', element: <DocumentPage /> },
      { path: '/dictionary', element: <DictionaryPage /> },
    ],
  },
  // The reader runs full-bleed without the app chrome.
  { path: '/read/:id', element: <ReaderPage /> },
]);

// Register the service worker so Readit installs as an app on desktop, Android
// and iOS, and opens without a connection. Failure here is never fatal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>,
);
