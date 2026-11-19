import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorState, SkeletonPage } from './components/ui';
import { useMe } from './lib/hooks';
import Login from './pages/Login';

// Route-level code splitting: each module loads only when opened.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Drill = lazy(() => import('./pages/Drill'));
const Dependencies = lazy(() => import('./pages/Dependencies'));
const Works = lazy(() => import('./pages/Works'));
const WorkDetail = lazy(() => import('./pages/WorkDetail'));
const WorksImport = lazy(() => import('./pages/WorksImport'));
const Schemes = lazy(() => import('./pages/Schemes'));
const Files = lazy(() => import('./pages/Files'));
const FileDetail = lazy(() => import('./pages/FileDetail'));
const Assets = lazy(() => import('./pages/Assets'));
const AssetDetail = lazy(() => import('./pages/AssetDetail'));
const Review = lazy(() => import('./pages/Review'));
const ReviewBrief = lazy(() => import('./pages/ReviewBrief'));
const Desk = lazy(() => import('./pages/Desk'));
const Audit = lazy(() => import('./pages/Audit'));
const PublicPortal = lazy(() => import('./pages/PublicPortal'));

function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <SkeletonPage />;
  if (me.error && me.error.status !== 401) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(me.data.role)) return <ErrorState error={{ message: 'This page is available to the DM and DDC only.' }} />;
  return <>{children}</>;
}

function Home() {
  const me = useMe();
  if (me.isLoading) return <SkeletonPage />;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Navigate to={me.data.role === 'dm' || me.data.role === 'ddc' ? '/dashboard' : '/desk'} replace />;
}

const inShell = (el: ReactNode, roles?: string[]) => (
  <RequireAuth roles={roles}>
    <AppShell>
      <Suspense fallback={<SkeletonPage />}>{el}</Suspense>
    </AppShell>
  </RequireAuth>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/public"
        element={
          <Suspense fallback={<div className="p-6"><SkeletonPage /></div>}>
            <PublicPortal />
          </Suspense>
        }
      />
      <Route path="/dashboard" element={inShell(<Dashboard />)} />
      <Route path="/drill" element={inShell(<Drill />)} />
      <Route path="/dependencies" element={inShell(<Dependencies />)} />
      <Route path="/works" element={inShell(<Works />)} />
      <Route path="/works/import" element={inShell(<WorksImport />)} />
      <Route path="/works/:id" element={inShell(<WorkDetail />)} />
      <Route path="/schemes" element={inShell(<Schemes />)} />
      <Route path="/files" element={inShell(<Files />)} />
      <Route path="/files/:id" element={inShell(<FileDetail />)} />
      <Route path="/assets" element={inShell(<Assets />)} />
      <Route path="/assets/:id" element={inShell(<AssetDetail />)} />
      <Route path="/review" element={inShell(<Review />)} />
      <Route
        path="/review/brief"
        element={
          <RequireAuth>
            <Suspense fallback={<SkeletonPage />}>
              <ReviewBrief />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="/desk" element={inShell(<Desk />)} />
      <Route path="/audit" element={inShell(<Audit />, ['dm', 'ddc'])} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
