"use client";

import { useEffect, useRef, useState } from "react";
import {
  AMENITIES,
  AMENITY_LABELS,
  CURRENCIES,
  DEFAULT_CURRENCY,
  OPERATIONS,
  OPERATION_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PROPERTY_KINDS,
  PROPERTY_KIND_LABELS,
  PROPERTY_STATUSES,
  PROPERTY_STATUS_LABELS,
  type Amenity,
  type Currency,
  type Operation,
  type PaymentMethod,
  type PropertyKind,
  type PropertyStatus,
} from "@/lib/realty/catalog";
import type { PropertyDto } from "@/lib/realty/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/components/realty/shared";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Texto → número, o null si el asesor dejó el campo vacío. */
function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Alta y edición de una propiedad. El ÚNICO campo obligatorio es el precio:
 * exigir más impide capturar un inmueble que el asesor apenas está
 * levantando (viene mirando la casa por teléfono, sin todos los datos a mano).
 */
export function PropertyForm({
  property,
  onClose,
  onSaved,
}: {
  property: PropertyDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [operation, setOperation] = useState<Operation>(
    property?.operation ?? "venta"
  );
  const [kind, setKind] = useState<PropertyKind>(property?.kind ?? "casa");
  const [title, setTitle] = useState(
    property?.hasCustomTitle ? property.title : ""
  );
  const [price, setPrice] = useState(property?.price ?? "");
  const [currency, setCurrency] = useState<Currency>(
    property?.currency ?? DEFAULT_CURRENCY
  );
  const [address, setAddress] = useState(property?.address ?? "");
  const [neighborhood, setNeighborhood] = useState(property?.neighborhood ?? "");
  const [city, setCity] = useState(property?.city ?? "");
  const [bedrooms, setBedrooms] = useState(
    property?.bedrooms === null || property?.bedrooms === undefined
      ? ""
      : String(property.bedrooms)
  );
  const [bathrooms, setBathrooms] = useState(property?.bathrooms ?? "");
  const [builtArea, setBuiltArea] = useState(property?.builtArea ?? "");
  const [lotArea, setLotArea] = useState(property?.lotArea ?? "");
  const [parking, setParking] = useState(
    property?.parking === null || property?.parking === undefined
      ? ""
      : String(property.parking)
  );
  const [amenities, setAmenities] = useState<Amenity[]>(
    property?.amenities ?? []
  );
  const [acceptedPayments, setAcceptedPayments] = useState<PaymentMethod[]>(
    property?.acceptedPayments ?? []
  );
  const [status, setStatus] = useState<PropertyStatus>(
    property?.status ?? "disponible"
  );
  const [description, setDescription] = useState(property?.description ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape cierra, como cualquier hoja modal; el foco arranca en el primer
  // campo para quien navega con teclado.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  }

  async function save() {
    const priceValue = toNumber(price);
    if (priceValue === null || priceValue <= 0) {
      setError("El precio es obligatorio y debe ser mayor que 0");
      return;
    }
    setSaving(true);
    setError(null);

    const body = {
      operation,
      kind,
      title: toText(title),
      price: priceValue,
      currency,
      address: toText(address),
      neighborhood: toText(neighborhood),
      city: toText(city),
      bedrooms: toNumber(bedrooms),
      bathrooms: toNumber(bathrooms),
      builtArea: toNumber(builtArea),
      lotArea: toNumber(lotArea),
      parking: toNumber(parking),
      amenities,
      acceptedPayments,
      status,
      description: toText(description),
    };

    const res = await fetch(
      property ? `/api/properties/${property.id}` : "/api/properties",
      {
        method: property ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    ).catch(() => null);

    setSaving(false);
    if (!res?.ok) {
      setError(await apiErrorMessage(res, "No se pudo guardar la propiedad"));
      return;
    }
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={property ? "Editar propiedad" : "Nueva propiedad"}
        className="my-6 w-full max-w-3xl rounded-lg border bg-card p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">
          {property ? "Editar propiedad" : "Nueva propiedad"}
        </h3>
        <p className="mb-4 text-xs text-text-3">
          Solo el precio es obligatorio. Lo demás lo completas después.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Operación" htmlFor="prop-operation">
            <select
              id="prop-operation"
              className={SELECT_CLASS}
              value={operation}
              onChange={(e) => setOperation(e.target.value as Operation)}
            >
              {OPERATIONS.map((value) => (
                <option key={value} value={value}>
                  {OPERATION_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tipo" htmlFor="prop-kind">
            <select
              id="prop-kind"
              className={SELECT_CLASS}
              value={kind}
              onChange={(e) => setKind(e.target.value as PropertyKind)}
            >
              {PROPERTY_KINDS.map((value) => (
                <option key={value} value={value}>
                  {PROPERTY_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Estatus" htmlFor="prop-status">
            <select
              id="prop-status"
              className={SELECT_CLASS}
              value={status}
              onChange={(e) => setStatus(e.target.value as PropertyStatus)}
            >
              {PROPERTY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PROPERTY_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Título"
            htmlFor="prop-title"
            className="sm:col-span-2 lg:col-span-3"
          >
            <Input
              id="prop-title"
              value={title}
              placeholder="Si lo dejas vacío se arma solo con el tipo y la ciudad"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label="Precio *" htmlFor="prop-price">
            <Input
              id="prop-price"
              inputMode="decimal"
              value={price}
              placeholder="135000"
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>

          <Field label="Moneda" htmlFor="prop-currency">
            <select
              id="prop-currency"
              className={SELECT_CLASS}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {CURRENCIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Estacionamientos" htmlFor="prop-parking">
            <Input
              id="prop-parking"
              inputMode="numeric"
              value={parking}
              onChange={(e) => setParking(e.target.value)}
            />
          </Field>

          <Field label="Zona / colonia" htmlFor="prop-neighborhood">
            <Input
              id="prop-neighborhood"
              value={neighborhood}
              placeholder="Equipetrol"
              onChange={(e) => setNeighborhood(e.target.value)}
            />
          </Field>

          <Field label="Ciudad" htmlFor="prop-city">
            <Input
              id="prop-city"
              value={city}
              placeholder="Santa Cruz"
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>

          <Field label="Dirección" htmlFor="prop-address">
            <Input
              id="prop-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>

          <Field label="Dormitorios" htmlFor="prop-bedrooms">
            <Input
              id="prop-bedrooms"
              inputMode="numeric"
              value={bedrooms}
              onChange={(e) => setBedrooms(e.target.value)}
            />
          </Field>

          <Field label="Baños" htmlFor="prop-bathrooms">
            <Input
              id="prop-bathrooms"
              inputMode="decimal"
              value={bathrooms}
              placeholder="1.5"
              onChange={(e) => setBathrooms(e.target.value)}
            />
          </Field>

          <Field label="m² construidos" htmlFor="prop-built">
            <Input
              id="prop-built"
              inputMode="decimal"
              value={builtArea}
              onChange={(e) => setBuiltArea(e.target.value)}
            />
          </Field>

          <Field label="m² de terreno" htmlFor="prop-lot">
            <Input
              id="prop-lot"
              inputMode="decimal"
              value={lotArea}
              onChange={(e) => setLotArea(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <CheckboxGroup
            title="Amenidades"
            options={AMENITIES.map((value) => ({
              value,
              label: AMENITY_LABELS[value],
            }))}
            selected={amenities}
            onToggle={(value) => setAmenities((prev) => toggle(prev, value))}
          />
          <CheckboxGroup
            title="Formas de pago que acepta"
            options={PAYMENT_METHODS.map((value) => ({
              value,
              label: PAYMENT_METHOD_LABELS[value],
            }))}
            selected={acceptedPayments}
            onToggle={(value) =>
              setAcceptedPayments((prev) => toggle(prev, value))
            }
          />
        </div>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="prop-description">Descripción</Label>
          <Textarea
            id="prop-description"
            rows={3}
            value={description}
            placeholder="Lo que le contarías al cliente por teléfono…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function CheckboxGroup<T extends string>({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="rounded-md border p-3">
      <legend className="kicker px-1">{title}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 items-center gap-1.5 text-[13px] text-text-2"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
