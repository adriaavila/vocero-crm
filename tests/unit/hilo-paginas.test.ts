import { describe, expect, it } from "vitest";
import { fundirMensajes } from "@/lib/hilo";
import type { MessageDto } from "@/lib/types";

const msg = (id: string, createdAt: string, status = "sent"): MessageDto =>
  ({ id, createdAt, status, direction: "in", text: id }) as unknown as MessageDto;

describe("hilo por páginas", () => {
  it("una página vieja entra arriba sin duplicar", () => {
    const ahora = [msg("c", "2026-10-08T10:02:00.000Z"), msg("d", "2026-10-08T10:03:00.000Z")];
    const vieja = [msg("a", "2026-10-08T10:00:00.000Z"), msg("b", "2026-10-08T10:01:00.000Z"), msg("c", "2026-10-08T10:02:00.000Z")];
    expect(fundirMensajes(ahora, vieja).map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("lo que llega gana (estado nuevo) y lo nuevo va al final", () => {
    const ahora = [msg("a", "2026-10-08T10:00:00.000Z", "sent")];
    const r = fundirMensajes(ahora, [msg("a", "2026-10-08T10:00:00.000Z", "read"), msg("b", "2026-10-08T10:05:00.000Z")]);
    expect(r.map((m) => [m.id, m.status])).toEqual([["a", "read"], ["b", "sent"]]);
  });

  it("mismo instante: desempata por id", () => {
    const t = "2026-10-08T10:00:00.000Z";
    expect(fundirMensajes([msg("m2", t)], [msg("m1", t)]).map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
