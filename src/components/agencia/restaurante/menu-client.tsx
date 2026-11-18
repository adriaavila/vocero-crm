"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { precio } from "@/lib/restaurante/pedido";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { aCentavos, deCentavos, llamar, type MenuCompleto } from "./api";

type Producto = MenuCompleto["items"][number];
type Borrador = {
  id: string | null;
  name: string;
  price: string;
  description: string;
  category: string;
  extras: { id?: string; name: string; price: string; active: boolean }[];
};

const VACIO: Borrador = { id: null, name: "", price: "", description: "", category: "", extras: [] };

/**
 * Fork — vertical restaurante: el menú. Es de donde el agente saca cada
 * precio, así que lo que se apaga o se agota aquí deja de ofrecerse en la
 * siguiente respuesta.
 */
export function MenuClient() {
  const [menu, setMenu] = useState<MenuCompleto | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [borrador, setBorrador] = useState<Borrador | null>(null);

  const cargar = useCallback(async () => {
    const r = await llamar<{ menu: MenuCompleto }>("/api/restaurante/menu");
    if (r.ok) setMenu(r.data.menu);
    else setFallo(r.message);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function enviar(url: string, method: string, body?: unknown): Promise<boolean> {
    setOcupado(true);
    setFallo(null);
    const r = await llamar<{ menu: MenuCompleto }>(url, { method, body });
    setOcupado(false);
    if (!r.ok) {
      setFallo(r.message);
      return false;
    }
    setMenu(r.data.menu);
    return true;
  }

  const cambiar = (id: string, cambio: Record<string, unknown>) =>
    enviar(`/api/restaurante/menu/${id}`, "PATCH", cambio);

  async function guardar(b: Borrador) {
    const priceCents = aCentavos(b.price);
    if (!b.name.trim() || priceCents === null) {
      setFallo("Ponle nombre y un precio, por ejemplo 42 o 12,50.");
      return;
    }
    const extras = [];
    for (const e of b.extras) {
      if (!e.name.trim()) continue;
      const cents = e.price.trim() === "" ? 0 : aCentavos(e.price);
      if (cents === null) {
        setFallo(`El precio del extra «${e.name}» no es un monto.`);
        return;
      }
      extras.push({ ...(e.id ? { id: e.id } : {}), name: e.name, priceCents: cents, active: e.active });
    }
    const body = {
      name: b.name,
      priceCents,
      description: b.description || null,
      ...(b.category.trim() ? { category: b.category } : { categoryId: null }),
      extras,
    };
    const ok = b.id
      ? await enviar(`/api/restaurante/menu/${b.id}`, "PATCH", body)
      : await enviar("/api/restaurante/menu", "POST", body);
    if (ok) setBorrador(null);
  }

  const abrir = (p: Producto) =>
    setBorrador({
      id: p.id,
      name: p.name,
      price: deCentavos(p.priceCents),
      description: p.description ?? "",
      category: menu?.categories.find((c) => c.id === p.categoryId)?.name ?? "",
      extras: p.extras.map((e) => ({
        id: e.id,
        name: e.name,
        price: e.priceCents ? deCentavos(e.priceCents) : "",
        active: e.active,
      })),
    });

  const grupos = menu
    ? [
        ...menu.categories.map((c) => ({ id: c.id, name: c.name, items: menu.items.filter((i) => i.categoryId === c.id) })),
        {
          id: "sin",
          name: "Sin categoría",
          items: menu.items.filter((i) => !menu.categories.some((c) => c.id === i.categoryId)),
        },
      ].filter((g) => g.items.length > 0)
    : [];
  const agotados = menu?.items.filter((i) => !i.enVenta).length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div>
          <h2 className="page-title font-semibold">Menú</h2>
          <p className="text-xs text-text-3">
            {menu === null
              ? "Cargando tu menú…"
              : menu.items.length === 0
                ? "Tu agente solo ofrece lo que esté aquí, con estos precios."
                : `${menu.items.length} productos${agotados ? ` · ${agotados} sin ofrecer ahora` : ""}. Tu agente solo ofrece lo que esté aquí.`}
          </p>
        </div>
        {menu && menu.items.length > 0 && (
          <Button className="max-sm:h-11" onClick={() => setBorrador(VACIO)}>
            <Plus className="h-4 w-4" /> Agregar producto
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {fallo && (
            <p role="alert" className="text-sm text-danger-text">
              {fallo}
            </p>
          )}

          {borrador && (
            <Formulario
              borrador={borrador}
              categorias={menu?.categories.map((c) => c.name) ?? []}
              moneda={menu?.currency ?? ""}
              ocupado={ocupado}
              onCambio={setBorrador}
              onGuardar={() => void guardar(borrador)}
              onCancelar={() => {
                setBorrador(null);
                setFallo(null);
              }}
              onQuitar={
                borrador.id
                  ? () => void cambiar(borrador.id!, { archived: true }).then((ok) => ok && setBorrador(null))
                  : undefined
              }
            />
          )}

          {menu && menu.items.length === 0 && !borrador && (
            <div className="rounded-[14px] border p-6 text-center">
              <p className="text-base font-medium">Tu menú está vacío.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-text-3">
                Carga tus productos, o empieza con el menú de ejemplo de «Doña Brasa», un restaurante
                inventado, para ver cómo tu agente arma un pedido. Después lo cambias por el tuyo.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button className="max-sm:h-11" onClick={() => setBorrador(VACIO)}>
                  Agregar mi primer producto
                </Button>
                <Button
                  variant="outline"
                  className="max-sm:h-11"
                  disabled={ocupado}
                  onClick={() => void enviar("/api/restaurante/menu/demo", "POST")}
                >
                  Cargar el menú de ejemplo
                </Button>
              </div>
            </div>
          )}

          {grupos.map((g) => (
            <section key={g.id} aria-label={g.name}>
              <h3 className="kicker px-0.5 text-text-2">{g.name}</h3>
              <ul className="mt-2 divide-y rounded-[14px] border">
                {g.items.map((p) => (
                  <li key={p.id} data-producto={p.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
                    <button type="button" onClick={() => abrir(p)} className="min-w-0 flex-1 basis-56 text-left">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("text-[15px] font-medium", !p.enVenta && "text-text-3")}>{p.name}</span>
                        <span className="font-mono text-[14px] text-text-2">{menu ? precio(p.priceCents, menu.currency) : ""}</span>
                      </span>
                      {p.description && <span className="mt-0.5 block text-[13px] text-text-3">{p.description}</span>}
                      {p.extras.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {p.extras.map((e) => (
                            <span
                              key={e.id}
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[12px] text-text-2",
                                !e.active && "line-through opacity-60"
                              )}
                            >
                              {e.name}
                              {e.priceCents > 0 && menu ? ` +${precio(e.priceCents, menu.currency)}` : ""}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-3">
                      {p.available &&
                        (p.enVenta ? (
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => void cambiar(p.id, { agotadoHoy: true })}
                            className="rounded-full border px-3 py-1.5 text-[12px] font-medium text-text-2 hover:border-border-strong max-sm:min-h-11"
                          >
                            Se agotó por hoy
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-state="atencion"
                            disabled={ocupado}
                            onClick={() => void cambiar(p.id, { agotadoHoy: false })}
                            className="rounded-full border border-[var(--st,var(--warning))] px-3 py-1.5 text-[12px] font-medium text-[var(--st-ink,var(--warning-text))] max-sm:min-h-11"
                          >
                            Agotado hoy · ya hay
                          </button>
                        ))}
                      <Switch
                        checked={p.available}
                        label={`Ofrecer ${p.name}`}
                        disabled={ocupado}
                        onCheckedChange={(next) => void cambiar(p.id, { available: next })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Formulario({
  borrador,
  categorias,
  moneda,
  ocupado,
  onCambio,
  onGuardar,
  onCancelar,
  onQuitar,
}: {
  borrador: Borrador;
  categorias: string[];
  moneda: string;
  ocupado: boolean;
  onCambio: (b: Borrador) => void;
  onGuardar: () => void;
  onCancelar: () => void;
  onQuitar?: () => void;
}) {
  const campo = "flex flex-col gap-1 text-[12px] font-medium text-text-2";
  return (
    <form
      aria-label={borrador.id ? "Editar producto" : "Producto nuevo"}
      className="flex flex-col gap-3 rounded-[14px] border bg-subtle p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className={campo}>
          Nombre
          <Input
            autoFocus
            value={borrador.name}
            maxLength={80}
            className="max-sm:h-11"
            onChange={(e) => onCambio({ ...borrador, name: e.target.value })}
          />
        </label>
        <label className={campo}>
          Precio{moneda ? ` (${moneda})` : ""}
          <Input
            inputMode="decimal"
            value={borrador.price}
            className="font-mono max-sm:h-11"
            onChange={(e) => onCambio({ ...borrador, price: e.target.value })}
          />
        </label>
      </div>
      <label className={campo}>
        Categoría
        <Input
          list="menu-categorias"
          placeholder="Hamburguesas, Bebidas…"
          value={borrador.category}
          maxLength={40}
          className="max-sm:h-11"
          onChange={(e) => onCambio({ ...borrador, category: e.target.value })}
        />
        <datalist id="menu-categorias">
          {categorias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className={campo}>
        Descripción (opcional)
        <Input
          value={borrador.description}
          maxLength={300}
          className="max-sm:h-11"
          onChange={(e) => onCambio({ ...borrador, description: e.target.value })}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[12px] font-medium text-text-2">Extras (sin precio = sin costo, como «sin cebolla»)</legend>
        {borrador.extras.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`Nombre del extra ${i + 1}`}
              placeholder="Extra queso"
              value={e.name}
              maxLength={60}
              className="max-sm:h-11"
              onChange={(ev) =>
                onCambio({
                  ...borrador,
                  extras: borrador.extras.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)),
                })
              }
            />
            <Input
              aria-label={`Precio del extra ${i + 1}`}
              inputMode="decimal"
              placeholder="0"
              value={e.price}
              className="w-24 shrink-0 font-mono max-sm:h-11"
              onChange={(ev) =>
                onCambio({
                  ...borrador,
                  extras: borrador.extras.map((x, j) => (j === i ? { ...x, price: ev.target.value } : x)),
                })
              }
            />
            <button
              type="button"
              className="shrink-0 px-1 text-[12px] text-text-3 hover:text-foreground max-sm:min-h-11"
              onClick={() => onCambio({ ...borrador, extras: borrador.extras.filter((_, j) => j !== i) })}
            >
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="self-start text-[13px] font-medium underline underline-offset-4 max-sm:min-h-11"
          onClick={() =>
            onCambio({ ...borrador, extras: [...borrador.extras, { name: "", price: "", active: true }] })
          }
        >
          Agregar un extra
        </button>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="max-sm:h-11" disabled={ocupado}>
          {ocupado ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="outline" className="max-sm:h-11" onClick={onCancelar}>
          Cancelar
        </Button>
        {onQuitar && (
          <button
            type="button"
            disabled={ocupado}
            onClick={onQuitar}
            className="ml-auto text-[13px] text-danger-text underline-offset-4 hover:underline max-sm:min-h-11"
          >
            Quitar del menú
          </button>
        )}
      </div>
    </form>
  );
}
