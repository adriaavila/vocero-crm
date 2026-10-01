import { getAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { isStillOwner } from "./auth";
import { readStateCookie, verifySignupState, type EmbeddedSignupMode, type SignupStateContext } from "./state";

export type SignupRequestAuth =
  | { ok: true; state: SignupStateContext }
  | { ok: false; status: number; step: "state" | "session" | "membership"; message: string };

/**
 * Las rutas del alta (`complete`, `event`) solo confían en el estado firmado:
 * la cookie y el cuerpo deben ser idénticos, la sesión debe ser del mismo
 * usuario y seguir siendo propietario. El negocio sale de ahí, nunca del cliente.
 */
export async function authorizeSignupRequest(
  request: Request,
  bodyState: string,
  mode: EmbeddedSignupMode,
): Promise<SignupRequestAuth> {
  const cookieState = readStateCookie(request.headers.get("cookie"));
  if (!cookieState || cookieState !== bodyState) {
    return { ok: false, status: 403, step: "state", message: "La sesión de conexión falta o no coincide. Vuelve a intentar." };
  }
  const state = verifySignupState(cookieState, getEnv().META_APP_SECRET);
  if (!state) {
    return { ok: false, status: 403, step: "state", message: "La sesión de conexión expiró o no es válida. Vuelve a intentar." };
  }
  if (state.mode !== mode) {
    return { ok: false, status: 400, step: "state", message: "El modo de conexión no coincide con el que iniciaste." };
  }
  const session = await getAuth().api.getSession({ headers: request.headers }).catch(() => null);
  if (!session || session.user.id !== state.userId) {
    return { ok: false, status: 401, step: "session", message: "Tu sesión expiró. Vuelve a iniciar sesión e intenta de nuevo." };
  }
  if (!(await isStillOwner(state.userId, state.orgId))) {
    return { ok: false, status: 403, step: "membership", message: "Ya no eres propietario de este negocio." };
  }
  return { ok: true, state };
}
