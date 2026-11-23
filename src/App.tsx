import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell.tsx";
import { batchHref } from "@/components/orders/BatchCard.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/primitives.tsx";
import { useApp, useSession } from "@/data/session.tsx";
import { useAsync } from "@/lib/useAsync.ts";
import { Landing } from "@/pages/Landing.tsx";
import { MapPinOff, ShieldX } from "lucide-react";
import { lazy, Suspense, type ComponentType } from "react";
import { Link } from "react-router-dom";

// Páginas carregadas sob demanda (o service worker as pré-armazena para uso offline).
const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, key: K) => lazy(() => load().then((m) => ({ default: m[key] })));
const Login = named(() => import("@/pages/auth/Login.tsx"), "Login");
const Signup = named(() => import("@/pages/auth/Signup.tsx"), "Signup");
const ForgotPassword = named(() => import("@/pages/auth/Recover.tsx"), "ForgotPassword");
const ResetPassword = named(() => import("@/pages/auth/Recover.tsx"), "ResetPassword");
const Onboarding = named(() => import("@/pages/onboarding/Onboarding.tsx"), "Onboarding");
const Home = named(() => import("@/pages/Home.tsx"), "Home");
const NewRoute = named(() => import("@/pages/NewRoute.tsx"), "NewRoute");
const History = named(() => import("@/pages/History.tsx"), "History");
const Profile = named(() => import("@/pages/Profile.tsx"), "Profile");
const Processing = named(() => import("@/pages/batch/Processing.tsx"), "Processing");
const Review = named(() => import("@/pages/batch/Review.tsx"), "Review");
const RoutePlan = named(() => import("@/pages/batch/RoutePlan.tsx"), "RoutePlan");
const Delivery = named(() => import("@/pages/batch/Delivery.tsx"), "Delivery");
const Summary = named(() => import("@/pages/batch/Summary.tsx"), "Summary");

function RequireSession() {
  const { status, error, refresh } = useSession();
  if (status === "loading") return <LoadingState label="Abrindo…" />;
  if (status === "signed_out") return <Navigate to="/entrar" replace />;
  if (status === "needs_onboarding") return <Navigate to="/configurar" replace />;
  if (status === "error") return <ErrorState message={error} onRetry={refresh} />;
  return <Outlet />;
}

function BatchRedirect() {
  const { id = "" } = useParams();
  const { backend } = useApp();
  const { data, error, reload } = useAsync(() => backend.getBundle(id), [backend, id]);
  if (error) {
    return /not_found|permiss/i.test(error.message)
      ? <EmptyState icon={ShieldX} title="Acesso negado ou lote inexistente" action={<Button asChild block><Link to="/app">Voltar ao início</Link></Button>}>Este lote não existe ou pertence a outra equipe.</EmptyState>
      : <ErrorState message={error.message} onRetry={reload} />;
  }
  if (!data) return <LoadingState />;
  return <Navigate to={batchHref(data.batch)} replace />;
}

function NotFound() {
  return <EmptyState icon={MapPinOff} title="Página não encontrada" action={<Button asChild block><Link to="/">Ir para o início</Link></Button>}>O endereço digitado não existe.</EmptyState>;
}

export function App() {
  return (
    <Suspense fallback={<LoadingState />}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/entrar" element={<Login />} />
      <Route path="/cadastro" element={<Signup />} />
      <Route path="/recuperar" element={<ForgotPassword />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      <Route path="/configurar" element={<Onboarding />} />
      <Route path="/app" element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="nova" element={<NewRoute />} />
          <Route path="historico" element={<History />} />
          <Route path="perfil" element={<Profile />} />
          <Route path="lote/:id" element={<BatchRedirect />} />
          <Route path="lote/:id/processando" element={<Processing />} />
          <Route path="lote/:id/enderecos" element={<Review />} />
          <Route path="lote/:id/rota" element={<RoutePlan />} />
          <Route path="lote/:id/entrega" element={<Delivery />} />
          <Route path="lote/:id/resumo" element={<Summary />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
