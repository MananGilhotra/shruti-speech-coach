import { Suspense, lazy } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { LoadingState } from './components/ui';
import Home from './pages/Home';

const Analysis = lazy(() => import('./pages/Analysis'));
const Analyse = lazy(() => import('./pages/Analyse'));
const Studio = lazy(() => import('./pages/Studio'));
const StudioReview = lazy(() => import('./pages/StudioReview'));
const Explore = lazy(() => import('./pages/Explore'));
const Evaluation = lazy(() => import('./pages/Evaluation'));
const Study = lazy(() => import('./pages/Study'));
const Method = lazy(() => import('./pages/Method'));
const NotFound = lazy(() => import('./pages/NotFound'));

export default function App() {
  const { pathname } = useLocation();
  return (
    <Layout>
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/analyse" element={<Analyse />} />
            <Route path="/analyse/:sid" element={<Analyse />} />
            <Route path="/analysis/:id" element={<Analysis />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/studio/review" element={<StudioReview />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/evaluation" element={<Evaluation />} />
            <Route path="/study" element={<Study />} />
            <Route path="/method" element={<Method />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
