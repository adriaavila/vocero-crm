import { isAllokSaaSMode } from "@/lib/tenant-host";
import { SAAS_SELF_SERVE } from "@/server/auth/registration";
import LoginForm from "./login-form";

export default function LoginPage() {
  return <LoginForm saasClosed={isAllokSaaSMode() && !SAAS_SELF_SERVE} />;
}
