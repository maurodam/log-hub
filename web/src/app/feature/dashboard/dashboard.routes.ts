import { Routes } from '@angular/router';
import { DashboardPage } from './pages/dashboard-page';

export default [
  { path: 'saved', title: 'Saved dashboards - LogHub',
    loadComponent: () => import('../query/saved-dashboard-page').then((m) => m.SavedDashboardPage) },
  { path: '',  title: 'Dashboard - LogHub', component: DashboardPage },
] satisfies Routes;
