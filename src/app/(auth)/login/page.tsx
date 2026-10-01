import { isAllokSaaSMode } from "@/lib/tenant-host";
import { isSaaSSelfServe } from "@/server/auth/registration";
import LoginForm from "./login-form";

export default function LoginPage() {
  return <LoginForm saasClosed={isAllokSaaSMode() && !isSaaSSelfServe()} />;
}
