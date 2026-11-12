import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import { Login, Register } from './pages/Auth';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Assistant = lazy(() => import('./pages/Assistant'));
const named = (load: () => Promise<any>, key: string) => lazy(() => load().then((m) => ({ default: m[key] })));
const Compare = named(() => import('./pages/Catalog'), 'Compare');
const Discover = named(() => import('./pages/Catalog'), 'Discover');
const ProductDetail = named(() => import('./pages/Catalog'), 'ProductDetail');
const Cart = named(() => import('./pages/Purchase'), 'Cart');
const Checkout = named(() => import('./pages/Purchase'), 'Checkout');
const Pay = named(() => import('./pages/Purchase'), 'Pay');
const OrderDetail = named(() => import('./pages/History'), 'OrderDetail');
const Orders = named(() => import('./pages/History'), 'Orders');
const Transactions = named(() => import('./pages/History'), 'Transactions');
const Notifications = named(() => import('./pages/Lists'), 'Notifications');
const PriceWatch = named(() => import('./pages/Lists'), 'PriceWatch');
const Wishlist = named(() => import('./pages/Lists'), 'Wishlist');
const Profile = named(() => import('./pages/Account'), 'Profile');
const Settings = named(() => import('./pages/Account'), 'Settings');
const Admin = lazy(() => import('./pages/Admin'));

function Protected({ admin }: { admin?: boolean }) {
  const { user, ready } = useApp();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <Layout />;
}

export default function App() {
  const init = useApp((s) => s.init);
  useEffect(() => { init(); }, [init]);
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Protected />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/pay/:id" element={<Pay />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/watch" element={<PriceWatch />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route element={<Protected admin />}><Route path="/admin" element={<Admin />} /></Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
