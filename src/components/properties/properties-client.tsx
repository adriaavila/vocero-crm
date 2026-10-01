"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Building2, Plus, Search } from "lucide-react";
import {
  OPERATIONS,
  OPERATION_LABELS,
  PROPERTY_KINDS,
  PROPERTY_KIND_LABELS,
  PROPERTY_STATUSES,
  PROPERTY_STATUS_LABELS,
  formatPrice,
  type Operation,
  type PropertyKind,
  type PropertyStatus,
} from "@/lib/realty/catalog";
import type { PropertiesListResponse, PropertyDto } from "@/lib/realty/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterPill, STATUS_BADGE_VARIANT, apiErrorMessage, placeholderGradient } from "@/components/realty/shared";
import { PropertyDetailPanel } from "./property-detail-panel";
import { PropertyForm } from "./property-form";

const PAGE_SIZE = 24;

const SELECT_CLASS =
  "h-9 max-sm:h-11 min-w-0 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function PropertiesClient() {
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<Operation | "">("");
  const [status, setStatus] = useState<PropertyStatus | "">("");
  const [kind, setKind] = useState<PropertyKind | "">("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<PropertiesListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PropertyDto | null>(null);
  const [detailRev, setDetailRev] = useState(0);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (operation) params.set("operation", operation);
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    if (archived) params.set("archived", "true");
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));

    const res = await fetch(`/api/properties?${params}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError(await apiErrorMessage(res, "No se pudo cargar el inventario"));
      return;
    }
    setData((await res.json()) as PropertiesListResponse);
    setError(null);
  }, [query, operation, status, kind, archived, page]);

  // Debounce del buscador (~300 ms): sin él cada tecla dispara una consulta.
  useEffect(() => {
    const timer = setTimeout(() => void refetch(), 300);
    return () => clearTimeout(timer);
  }, [refetch]);

  // Enlace directo (p. ej. desde la agenda, parte 2): /properties?propiedad=<id>
  const searchParams = useSearchParams();
  const propertyParam = searchParams.get("propiedad");
  useEffect(() => {
    if (propertyParam) setSelectedId(propertyParam);
  }, [propertyParam]);

  /** Cambiar un filtro siempre vuelve a la página 1. */
  function withReset(apply: () => void) {
    apply();
    setPage(1);
  }

  async function changeStatus(id: string, next: PropertyStatus) {
    const res = await fetch(`/api/properties/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(await apiErrorMessage(res, "No se pudo cambiar el estatus"));
      return;
    }
    void refetch();
  }

  async function toggleArchived(property: PropertyDto) {
    const res = await fetch(`/api/properties/${property.id}`, {
      method: property.archivedAt ? "PUT" : "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      setError(await apiErrorMessage(res, "No se pudo archivar la propiedad"));
      return;
    }
    void refetch();
  }

  const properties = data?.properties ?? [];
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const hasFilters =
    query.trim() !== "" || operation !== "" || status !== "" || kind !== "";

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
          <div>
            <h2 className="font-semibold">Propiedades</h2>
            <p className="text-xs text-text-3">
              {loading
                ? "Cargando inventario…"
                : `${total} ${total === 1 ? "propiedad" : "propiedades"} con estos filtros`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-3" />
              <Input
                placeholder="Buscar propiedad…"
                value={query}
                onChange={(e) => withReset(() => setQuery(e.target.value))}
                className="w-full pl-8 sm:w-72"
              />
            </div>
            <Button
              size="sm"
              className="max-sm:h-11"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Nueva
            </Button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 sm:px-6">
          <FilterRow label="Operación">
            <FilterPill active={operation === ""} onClick={() => withReset(() => setOperation(""))}>
              Todas
            </FilterPill>
            {OPERATIONS.map((value) => (
              <FilterPill
                key={value}
                active={operation === value}
                onClick={() => withReset(() => setOperation(value))}
              >
                {OPERATION_LABELS[value]}
              </FilterPill>
            ))}
          </FilterRow>

          <FilterRow label="Tipo">
            <select
              aria-label="Filtrar por tipo"
              className={SELECT_CLASS}
              value={kind}
              onChange={(e) => withReset(() => setKind(e.target.value as PropertyKind | ""))}
            >
              <option value="">Todos</option>
              {PROPERTY_KINDS.map((value) => (
                <option key={value} value={value}>
                  {PROPERTY_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </FilterRow>

          <FilterRow label="Visibilidad">
            <FilterPill active={!archived} onClick={() => withReset(() => setArchived(false))}>
              Activas
            </FilterPill>
            <FilterPill active={archived} onClick={() => withReset(() => setArchived(true))}>
              Archivadas
            </FilterPill>
          </FilterRow>

          {!archived && (
            <FilterRow label="Estatus">
              <select
                aria-label="Filtrar por estatus"
                className={SELECT_CLASS}
                value={status}
                onChange={(e) => withReset(() => setStatus(e.target.value as PropertyStatus | ""))}
              >
                <option value="">Todos</option>
                {PROPERTY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {PROPERTY_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </FilterRow>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-lg border bg-card">
                  <Skeleton className="h-36 w-full rounded-none" />
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-6 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : properties.length === 0 ? (
            <EmptyState
              archived={archived}
              filtered={hasFilters}
              onCreate={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {properties.map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  selected={property.id === selectedId}
                  onOpen={() => setSelectedId(property.id)}
                  onStatus={(next) => void changeStatus(property.id, next)}
                  onArchive={() => void toggleArchived(property)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Paginación REAL: nada de truncar el inventario en silencio. */}
        {!loading && total > 0 && pageCount > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-text-2 sm:px-6">
            <span>
              Página {data?.page ?? 1} de {pageCount} · {total}{" "}
              {total === 1 ? "resultado" : "resultados"}
            </span>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                className="max-sm:h-11"
                variant="outline"
                disabled={(data?.page ?? 1) <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                className="max-sm:h-11"
                variant="outline"
                disabled={(data?.page ?? 1) >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Siguiente
              </Button>
            </span>
          </div>
        )}
      </div>

      {selectedId && (
        <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[400px] shrink-0 overflow-hidden border-l bg-background shadow-pop lg:static lg:z-auto lg:shadow-none">
          <PropertyDetailPanel
            key={selectedId}
            propertyId={selectedId}
            refreshKey={detailRev}
            onClose={() => setSelectedId(null)}
            onChanged={() => void refetch()}
            onEdit={(property) => {
              setEditing(property);
              setFormOpen(true);
            }}
          />
        </aside>
      )}

      {formOpen && (
        <PropertyForm
          key={editing?.id ?? "nueva"}
          property={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            setDetailRev((v) => v + 1);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="kicker">{label}</span>
      {children}
    </div>
  );
}

function PropertyCard({
  property,
  selected,
  onOpen,
  onStatus,
  onArchive,
}: {
  property: PropertyDto;
  selected: boolean;
  onOpen: () => void;
  onStatus: (next: PropertyStatus) => void;
  onArchive: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow",
        selected && "ring-2 ring-brand-soft"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative block h-36 w-full text-left"
        aria-label={`Ver ${property.title}`}
      >
        {property.coverPhotoUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={property.coverPhotoUrl}
            alt=""
            onError={() => setImgFailed(true)}
            className="h-36 w-full object-cover"
          />
        ) : (
          <span
            className={`flex h-36 w-full items-center justify-center bg-gradient-to-br text-xs text-text-2 ${placeholderGradient(
              property.id
            )}`}
          >
            {imgFailed ? "Foto no disponible" : "Sin fotos"}
          </span>
        )}
        <span className="absolute left-2 top-2">
          <Badge variant={STATUS_BADGE_VARIANT[property.status]}>
            {property.archivedAt ? "Archivada" : PROPERTY_STATUS_LABELS[property.status]}
          </Badge>
        </span>
        <span className="absolute right-2 top-2">
          <Badge variant="secondary">{OPERATION_LABELS[property.operation]}</Badge>
        </span>
      </button>

      <div className="p-3">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <p className="truncate text-[13px] font-semibold">{property.title}</p>
          <p className="truncate text-xs text-text-3">{property.zone}</p>
          <p className="mt-1.5 text-[20px] font-semibold leading-tight tabular-nums">
            {formatPrice(property.price, property.currency)}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-2">
            {property.specs || PROPERTY_KIND_LABELS[property.kind]}
          </p>
        </button>

        <div className="mt-2.5 flex items-center justify-between gap-2 border-t pt-2.5">
          <select
            aria-label={`Estatus de ${property.title}`}
            className={SELECT_CLASS}
            value={property.status}
            onChange={(e) => onStatus(e.target.value as PropertyStatus)}
          >
            {PROPERTY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PROPERTY_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1 text-[11px] text-text-3">
            {property.photoCount} {property.photoCount === 1 ? "foto" : "fotos"}
            <button
              type="button"
              aria-label={property.archivedAt ? "Desarchivar" : "Archivar"}
              title={property.archivedAt ? "Desarchivar" : "Archivar"}
              onClick={onArchive}
              className="flex h-9 w-9 max-sm:h-11 max-sm:w-11 items-center justify-center rounded text-text-3 hover:bg-accent hover:text-foreground"
            >
              {property.archivedAt ? (
                <ArchiveRestore className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}

function EmptyState({
  archived,
  filtered,
  onCreate,
}: {
  archived: boolean;
  filtered: boolean;
  onCreate: () => void;
}) {
  if (archived) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Archive className="h-8 w-8 text-text-3" strokeWidth={1.5} />
        <p className="text-sm font-medium">Sin propiedades archivadas</p>
        <p className="max-w-sm text-xs text-text-3">
          Archivar una propiedad la esconde del catálogo sin borrar nada:
          siempre la puedes recuperar con su estatus intacto.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Building2 className="h-8 w-8 text-text-3" strokeWidth={1.5} />
      <p className="text-sm font-medium">
        {filtered ? "Ninguna propiedad coincide" : "Todavía no hay propiedades"}
      </p>
      <p className="max-w-sm text-xs text-text-3">
        {filtered
          ? "Prueba con otra búsqueda o quita algún filtro."
          : "Da de alta tu inventario para que tu agente pueda recomendarlo y mandar fichas por WhatsApp."}
      </p>
      {!filtered && (
        <Button size="sm" className="mt-1 max-sm:h-11" onClick={onCreate}>
          <Plus className="h-4 w-4" /> Nueva propiedad
        </Button>
      )}
    </div>
  );
}
