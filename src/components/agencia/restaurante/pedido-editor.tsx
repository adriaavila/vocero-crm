"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { precio, type LineaPedida } from "@/lib/restaurante/pedido";
import { Button } from "@/components/ui/button";
import { llamar, type MenuCompleto } from "./api";

/**
 * Editar (o armar a mano) las líneas de un pedido. Solo se eligen productos
 * del menú: el precio no se escribe aquí, sale del menú al guardar.
 */
export function PedidoEditor({
  inicial,
  guardando,
  error,
  onGuardar,
  onCancelar,
}: {
  inicial: LineaPedida[];
  guardando: boolean;
  error: string | null;
  onGuardar: (lineas: LineaPedida[]) => void;
  onCancelar: () => void;
}) {
  const [lineas, setLineas] = useState<LineaPedida[]>(inicial);
  const [menu, setMenu] = useState<MenuCompleto | null>(null);
  const [elegido, setElegido] = useState("");

  useEffect(() => {
    void llamar<{ menu: MenuCompleto }>("/api/restaurante/menu").then((r) => {
      if (r.ok) setMenu(r.data.menu);
    });
  }, []);

  const cambiar = (i: number, cambio: Partial<LineaPedida>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)));

  const agregar = (id: string) => {
    const producto = menu?.items.find((p) => p.id === id);
    if (!producto) return;
    setLineas((ls) => [...ls, { name: producto.name, quantity: 1, extras: [] }]);
    setElegido("");
  };

  const enVenta = menu?.items.filter((p) => p.enVenta) ?? [];

  return (
    <div className="flex flex-col gap-3">
      {lineas.length === 0 && (
        <p className="text-[13px] text-text-3">Agrega lo que pidió el cliente desde tu menú.</p>
      )}
      <ul className="flex flex-col gap-2">
        {lineas.map((l, i) => {
          const producto = menu?.items.find((p) => p.name === l.name);
          const extras = producto?.extras.filter((e) => e.active) ?? [];
          return (
            <li key={`${l.name}-${i}`} className="rounded-md border bg-subtle p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{l.name}</span>
                <button
                  type="button"
                  aria-label={`Una menos de ${l.name}`}
                  disabled={l.quantity <= 1}
                  onClick={() => cambiar(i, { quantity: l.quantity - 1 })}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-text-2 hover:bg-accent disabled:opacity-40 max-sm:h-11 max-sm:w-11"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-5 text-center font-mono text-[13px]" aria-label={`Cantidad de ${l.name}`}>
                  {l.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Una más de ${l.name}`}
                  onClick={() => cambiar(i, { quantity: Math.min(50, l.quantity + 1) })}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-text-2 hover:bg-accent max-sm:h-11 max-sm:w-11"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Quitar ${l.name}`}
                  onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-3 hover:bg-accent hover:text-foreground max-sm:h-11 max-sm:w-11"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {extras.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {extras.map((e) => {
                    const puesto = (l.extras ?? []).includes(e.name);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        aria-pressed={puesto}
                        onClick={() =>
                          cambiar(i, {
                            extras: puesto
                              ? (l.extras ?? []).filter((x) => x !== e.name)
                              : [...(l.extras ?? []), e.name],
                          })
                        }
                        className={
                          puesto
                            ? "rounded-full border border-foreground bg-foreground px-2.5 py-1 text-[12px] font-medium text-background"
                            : "rounded-full border px-2.5 py-1 text-[12px] text-text-2 hover:border-border-strong"
                        }
                      >
                        {e.name}
                        {e.priceCents > 0 && menu ? ` +${precio(e.priceCents, menu.currency)}` : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <label className="flex flex-col gap-1 text-[12px] text-text-3">
        Agregar del menú
        <select
          value={elegido}
          onChange={(e) => agregar(e.target.value)}
          disabled={!menu}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground max-sm:h-11"
        >
          <option value="">{menu ? "Elige un producto" : "Cargando tu menú…"}</option>
          {enVenta.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {menu ? precio(p.priceCents, menu.currency) : ""}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 max-sm:h-11"
          disabled={guardando || lineas.length === 0}
          onClick={() => onGuardar(lineas)}
        >
          {guardando ? "Guardando…" : "Guardar pedido"}
        </Button>
        <Button size="sm" variant="outline" className="max-sm:h-11" disabled={guardando} onClick={onCancelar}>
          Volver
        </Button>
      </div>
    </div>
  );
}
