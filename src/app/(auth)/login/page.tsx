import { brand } from "@/lib/brand";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { isSaaSSelfServe } from "@/server/auth/registration";
import { contactChannelSuffix, helpUrl, startUrl } from "@/components/agencia/allok/setup-contact";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <LoginForm
      saasClosed={isAllokSaaSMode() && !isSaaSSelfServe()}
      brandName={brand().name}
      startUrl={startUrl()}
      helpUrl={helpUrl()}
      channelSuffix={contactChannelSuffix()}
    />
  );
}
