import { describe, expect, it } from "vitest";
import { inAppBrowserName } from "@/lib/navegador-meta";
import { onboardingErrorCopy } from "@/lib/onboarding-errors";

const IG_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.29.92 (iPhone14,5; iOS 18_5; es_MX; es; scale=3.00; 1170x2532; 760135573)";
const FB_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/485.0.0.70.77;]";
const TIKTOK =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/es Region/MX";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

describe("navegador donde la ventana de Meta no abre", () => {
  it("reconoce los navegadores internos de Instagram, Facebook y TikTok", () => {
    expect(inAppBrowserName(IG_IOS)).toBe("Instagram");
    expect(inAppBrowserName(FB_ANDROID)).toBe("Facebook");
    expect(inAppBrowserName(TIKTOK)).toBe("TikTok");
  });

  it("Safari, Chrome y un agente vacío no son navegadores internos", () => {
    expect(inAppBrowserName(SAFARI)).toBeNull();
    expect(inAppBrowserName(CHROME)).toBeNull();
    expect(inAppBrowserName("")).toBeNull();
    expect(inAppBrowserName(undefined)).toBeNull();
  });

  it("un SDK bloqueado tiene su propia copia, con reintento", () => {
    const copy = onboardingErrorCopy("meta_blocked");
    expect(copy.title).not.toBe(onboardingErrorCopy("meta_unavailable").title);
    expect(copy.body).toMatch(/Chrome o Safari/);
    expect(copy.retry).toBe(true);
  });
});
