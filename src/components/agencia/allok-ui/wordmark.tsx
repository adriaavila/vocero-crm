import type { Branding } from "@/lib/branding";
import { BrandLogo } from "@/components/brand-mark";

/** Custom tenant identities keep their configured logo. */
export function AllokWordmark({ branding }: { branding: Pick<Branding, "name"> }) {
  if (branding.name.trim().toLowerCase() !== "allok") return <BrandLogo branding={branding} />;
  return <span className="allok-wordmark" aria-label="Allok">allok<span aria-hidden="true" /></span>;
}
