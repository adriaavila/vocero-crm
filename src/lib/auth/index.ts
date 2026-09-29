import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv, isMockEnabled } from "@/lib/env";
import { AUTH_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";
import {
  onUserCreated,
  resolveActiveOrganizationId,
  resolveOrganizationIdForHost,
} from "@/server/auth/on-signup";
import { isPublicSignupAllowed, isSaaSSelfServe } from "@/server/auth/registration";
import { brand } from "@/lib/brand";
import {
  isAllokSaaSMode,
  isKnownAllokHost,
  isSaaSAdminEmail,
  isSaaSAppHost,
  resolvedRootDomain,
  saasAppHost,
  tenantSlugFromHost,
  trustedOriginForRequest,
} from "@/lib/tenant-host";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro cerrado. No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__voceroInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}

/**
 * ¿La petición trae la sesión de un admin de allok? Con el autoservicio
 * apagado, el alta de un negocio la hace allok en la llamada de puesta en
 * marcha, desde su propia sesión (la cookie vive en `.allok.fun`).
 */
async function isSaaSAdminRequest(requestHeaders: Headers | undefined): Promise<boolean> {
  if (!requestHeaders) return false;
  const session = await getAuth().api.getSession({ headers: requestHeaders }).catch(() => null);
  return isSaaSAdminEmail(session?.user.email);
}

const RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

function createAuth() {
  const env = getEnv();
  const appHost = new URL(env.APP_BASE_URL).hostname;
  const cookieDomain = appHost === "localhost"
    ? ".localhost"
    : `.${resolvedRootDomain()}`;
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    // En el SaaS el login ocurre en cada `<negocio>.<raíz>`, en el host de
    // alta y en admin, no solo en APP_BASE_URL.
    trustedOrigins: (request?: Request): string[] => {
      if (!isAllokSaaSMode()) return [];
      const origin = trustedOriginForRequest(
        request?.headers.get("origin"),
        request?.headers.get("x-forwarded-host") ?? request?.headers.get("host"),
      );
      return origin ? [origin] : [];
    },
    advanced: {
      // The SaaS app host and negocio.allok.fun must share the same session,
      // but legacy deployments keep host-only cookies exactly as before.
      crossSubDomainCookies: isAllokSaaSMode()
        ? {
            enabled: true,
            domain: cookieDomain,
          }
        : undefined,
    },
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    plugins: [
      organization({
        creatorRole: "owner",
        // En el SaaS cada negocio lo crea allok (autoservicio apagado): sin
        // esto, cualquier usuario con sesión abría otro con
        // `/organization/create`, saltándose el registro y el slug reservado.
        allowUserToCreateOrganization: (user) =>
          !isAllokSaaSMode() || isSaaSAdminEmail(user.email),
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (isAllokSaaSMode()) {
          const host =
            ctx.headers?.get("x-forwarded-host") ?? ctx.headers?.get("host");
          if (!isKnownAllokHost(host)) {
            throw new APIError("NOT_FOUND", {
              message: `El host de ${brand().Name} no existe`,
            });
          }
          const tenantSlug = tenantSlugFromHost(host);
          if (tenantSlug && !(await resolveOrganizationIdForHost(host))) {
            throw new APIError("NOT_FOUND", {
              message: "El negocio no existe",
            });
          }
        }
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        //
        // Se levanta SOLO en el entorno de pruebas internas (`isMockEnabled`:
        // WA_MOCK_ENABLED=true y fuera de producción, el mismo gate de los
        // mocks). El arnés E2E son ~15 guiones que inician sesión cada uno, y
        // desde una sola IP eso pasa de 10 en el primer minuto: la suite
        // fallaba con 429 y parecía un fallo del producto. En producción el
        // límite no se toca — y ahí el gate es imposible de encender.
        if (RATE_LIMITED_PATHS.has(ctx.path) && !isMockEnabled()) {
          const ip =
            ctx.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            ctx.headers?.get("x-real-ip") ||
            "local";
          const result = checkRateLimit(`${ctx.path}:${ip}`, AUTH_RATE_LIMIT);
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        // Registro público cerrado tras la primera organización (FR-060).
        if (ctx.path === "/sign-up/email") {
          const host =
            ctx.headers?.get("x-forwarded-host") ?? ctx.headers?.get("host");
          if (isAllokSaaSMode() && !isSaaSAppHost(host)) {
            throw new APIError("FORBIDDEN", {
              // El prefijo "El registro" es lo que el formulario reconoce
              // (register-form.tsx) para mostrar esto tal cual en vez de un
              // genérico "instancia ya tiene organización": el cliente no
              // puede leer `BRAND` (no es NEXT_PUBLIC_), así que el nombre de
              // marca va DESPUÉS del prefijo estable, nunca dentro de él.
              message: `El registro de ${brand().Name} empieza en ${saasAppHost()}`,
            });
          }
          if (
            !isInternalSignup() &&
            !(await isPublicSignupAllowed()) &&
            // El arnés E2E (`isMockEnabled`, nunca en producción) crea sus
            // negocios de prueba por aquí, como el límite de arriba.
            !(isAllokSaaSMode() && (isMockEnabled() || (await isSaaSAdminRequest(ctx.headers))))
          ) {
            throw new APIError("FORBIDDEN", {
              message:
                "El registro está cerrado: esta instancia ya tiene su organización",
            });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            const internal = isInternalSignup();
            await onUserCreated(user.id, user.name, {
              skipOrganization: internal,
              // La manda /register: fija la zona del horario del negocio nuevo.
              timezone: context?.headers?.get("x-timezone"),
              // Registro público con el autoservicio encendido. Un negocio que
              // crea un admin de allok sigue el camino de la puesta en marcha.
              selfServeTrial:
                !internal &&
                isAllokSaaSMode() &&
                isSaaSSelfServe() &&
                !(await isSaaSAdminRequest(context?.headers)),
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const organizationId = isAllokSaaSMode()
              ? null
              : await resolveActiveOrganizationId(session.userId);
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}
