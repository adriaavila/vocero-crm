"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  ArchiveRestore,
  ImagePlus,
  Pencil,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  AMENITY_LABELS,
  OPERATION_LABELS,
  PAYMENT_METHOD_LABELS,
  PROPERTY_KIND_LABELS,
  PROPERTY_STATUSES,
  PROPERTY_STATUS_LABELS,
  formatPrice,
  type PropertyStatus,
} from "@/lib/realty/catalog";
import type { PropertyDetailResponse, PropertyDto, PropertyPhotoDto } from "@/lib/realty/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATUS_BADGE_VARIANT,
  apiErrorMessage,
  placeholderGradient,
} from "@/components/realty/shared";
import { MAX_PHOTOS_PER_PROPERTY, preparePhoto } from "@/components/realty/resize-image";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Detalle DENTRO del listado (no navega a otra página): así el asesor puede
 * revisar una propiedad sin perder el filtro y el scroll del catálogo.
 */
export function PropertyDetailPanel({
  propertyId,
  refreshKey = 0,
  onClose,
  onChanged,
  onEdit,
}: {
  propertyId: string;
  /** Sube cuando el formulario guardó: obliga a releer la propiedad abierta. */
  refreshKey?: number;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (property: PropertyDto) => void;
}) {
  const [property, setProperty] = useState<PropertyDto | null>(null);
  const [photos, setPhotos] = useState<PropertyPhotoDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/properties/${propertyId}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError(await apiErrorMessage(res, "No se pudo cargar la propiedad"));
      return;
    }
    const data = (await res.json()) as PropertyDetailResponse;
    setProperty(data.property);
    setPhotos(data.photos);
    setError(null);
  }, [propertyId]);

  useEffect(() => {
    void refetch();
  }, [refetch, refreshKey]);

  async function changeStatus(status: PropertyStatus) {
    const res = await fetch(`/api/properties/${propertyId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(await apiErrorMessage(res, "No se pudo cambiar el estatus"));
      return;
    }
    await refetch();
    onChanged();
  }

  async function toggleArchived(archived: boolean) {
    const res = await fetch(`/api/properties/${propertyId}`, {
      method: archived ? "DELETE" : "PUT",
    }).catch(() => null);
    if (!res?.ok) {
      setError(await apiErrorMessage(res, "No se pudo archivar la propiedad"));
      return;
    }
    await refetch();
    onChanged();
  }

  /**
   * Sube las fotos una a una. Si alguna falla, se anota el motivo y el resto
   * CONTINÚA: una foto pesada no puede tumbar toda la carga.
   */
  async function uploadPhotos(files: File[]) {
    const errors: string[] = [];
    let room = MAX_PHOTOS_PER_PROPERTY - photos.length;
    let index = 0;

    for (const file of files) {
      index += 1;
      if (room <= 0) {
        errors.push(
          `${file.name}: se alcanzó el máximo de ${MAX_PHOTOS_PER_PROPERTY} fotos`
        );
        continue;
      }
      setUploading(`Subiendo ${index} de ${files.length}…`);

      const prepared = await preparePhoto(file);
      if (!prepared.ok) {
        errors.push(prepared.message);
        continue;
      }
      const res = await fetch(`/api/properties/${propertyId}/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mimeType: prepared.mimeType,
          data: prepared.data,
        }),
      }).catch(() => null);
      if (!res?.ok) {
        errors.push(`${file.name}: ${await apiErrorMessage(res)}`);
        continue;
      }
      room -= 1;
    }

    setUploading(null);
    setUploadErrors(errors);
    await refetch();
    onChanged();
  }

  async function movePhoto(photoId: string, position: number) {
    const res = await fetch(
      `/api/properties/${propertyId}/photos/${photoId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position }),
      }
    ).catch(() => null);
    if (!res?.ok) {
      setUploadErrors([await apiErrorMessage(res, "No se pudo mover la foto")]);
      return;
    }
    const data = (await res.json()) as { photos: PropertyPhotoDto[] };
    setPhotos(data.photos);
    onChanged();
  }

  async function removePhoto(photoId: string) {
    const res = await fetch(
      `/api/properties/${propertyId}/photos/${photoId}`,
      { method: "DELETE" }
    ).catch(() => null);
    if (!res?.ok) {
      setUploadErrors([
        await apiErrorMessage(res, "No se pudo eliminar la foto"),
      ]);
      return;
    }
    const data = (await res.json()) as { photos: PropertyPhotoDto[] };
    setPhotos(data.photos);
    onChanged();
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Detalle" onClose={onClose} />
        <div className="space-y-4 p-4">
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Detalle" onClose={onClose} />
        <p className="p-4 text-sm text-destructive">
          {error ?? "No se pudo cargar la propiedad"}
        </p>
      </div>
    );
  }

  const archived = property.archivedAt !== null;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={property.title} onClose={onClose} />

      <div className="flex-1 overflow-y-auto">
        {error && <p className="m-4 text-sm text-destructive">{error}</p>}

        {/* Galería */}
        <section className="border-b p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="kicker">
              Fotos ({photos.length}/{MAX_PHOTOS_PER_PROPERTY})
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={
                uploading !== null || photos.length >= MAX_PHOTOS_PER_PROPERTY
              }
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" /> Subir
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) void uploadPhotos(files);
              }}
            />
          </div>

          {uploading && <p className="mb-2 text-xs text-text-3">{uploading}</p>}
          {uploadErrors.length > 0 && (
            <ul className="mb-2 space-y-1">
              {uploadErrors.map((message) => (
                <li key={message} className="text-xs text-destructive">
                  {message}
                </li>
              ))}
            </ul>
          )}

          {photos.length === 0 ? (
            <div
              className={`flex h-24 items-center justify-center rounded-md bg-gradient-to-br text-xs text-text-2 ${placeholderGradient(
                property.id
              )}`}
            >
              Sin fotos todavía
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photos.map((photo, index) => (
                <li
                  key={photo.id}
                  className="overflow-hidden rounded-md border bg-subtle"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={`Foto ${index + 1} de ${property.title}`}
                    className="h-20 w-full object-cover"
                  />
                  <div className="flex items-center justify-between px-0.5 py-0.5">
                    {photo.isCover ? (
                      <span className="px-1 text-[9px] font-semibold uppercase text-brand-text">
                        Portada
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label="Marcar como portada"
                        title="Marcar como portada"
                        className="flex h-9 w-9 items-center justify-center rounded text-text-3 hover:text-foreground"
                        onClick={() => void movePhoto(photo.id, 0)}
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <span className="flex items-center">
                      <button
                        type="button"
                        aria-label="Mover a la izquierda"
                        disabled={index === 0}
                        className="flex h-9 w-9 items-center justify-center rounded text-text-3 hover:text-foreground disabled:opacity-30"
                        onClick={() => void movePhoto(photo.id, index - 1)}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Mover a la derecha"
                        disabled={index === photos.length - 1}
                        className="flex h-9 w-9 items-center justify-center rounded text-text-3 hover:text-foreground disabled:opacity-30"
                        onClick={() => void movePhoto(photo.id, index + 1)}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Eliminar foto"
                        className="flex h-9 w-9 items-center justify-center rounded text-text-3 hover:text-destructive"
                        onClick={() => void removePhoto(photo.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-text-3">
            JPEG, PNG o WebP. Se reescalan en tu navegador antes de subirse,
            así que casi nunca vas a toparte con el tope de 3 MB.
          </p>
        </section>

        {/* Acciones rápidas */}
        <section className="flex flex-wrap items-center gap-2 border-b p-4">
          <select
            aria-label="Estatus de la propiedad"
            className={SELECT_CLASS}
            value={property.status}
            onChange={(e) => void changeStatus(e.target.value as PropertyStatus)}
          >
            {PROPERTY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PROPERTY_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => onEdit(property)}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void toggleArchived(!archived)}
          >
            {archived ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" /> Desarchivar
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" /> Archivar
              </>
            )}
          </Button>
        </section>

        {/* Datos */}
        <section className="border-b p-4">
          <p className="text-[28px] font-semibold leading-tight tabular-nums">
            {formatPrice(property.price, property.currency)}
          </p>
          <p className="mt-0.5 text-[13px] text-text-2">{property.zone}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={STATUS_BADGE_VARIANT[property.status]}>
              {PROPERTY_STATUS_LABELS[property.status]}
            </Badge>
            <Badge variant="secondary">
              {OPERATION_LABELS[property.operation]}
            </Badge>
            <Badge variant="secondary">
              {PROPERTY_KIND_LABELS[property.kind]}
            </Badge>
            {archived && <Badge variant="secondary">Archivada</Badge>}
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
            <Row label="Dormitorios" value={property.bedrooms} />
            <Row label="Baños" value={property.bathrooms} />
            <Row label="m² construidos" value={property.builtArea} />
            <Row label="m² de terreno" value={property.lotArea} />
            <Row label="Estacionamientos" value={property.parking} />
            <Row label="Zona" value={property.neighborhood} />
            <Row label="Ciudad" value={property.city} />
            <Row label="Dirección" value={property.address} />
          </dl>

          <div className="mt-3">
            <p className="kicker">Amenidades</p>
            {property.amenities.length === 0 ? (
              <p className="text-[13px] text-text-3">Sin amenidades captadas</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {property.amenities.map((amenity) => (
                  <Badge key={amenity} variant="secondary">
                    {AMENITY_LABELS[amenity]}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3">
            <p className="kicker">Formas de pago</p>
            {property.acceptedPayments.length === 0 ? (
              <p className="text-[13px] text-text-3">
                Sin capturar: no resta puntos en el match
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {property.acceptedPayments.map((method) => (
                  <Badge key={method} variant="secondary">
                    {PAYMENT_METHOD_LABELS[method]}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {property.description && (
            <p className="mt-3 whitespace-pre-wrap text-[13px] text-text-2">
              {property.description}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function PanelHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-2 border-b bg-background px-4 py-3">
      <h3 className="truncate text-[13px] font-[650]">{title}</h3>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar detalle"
        className="flex h-9 w-9 items-center justify-center rounded text-text-3 hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" strokeWidth={1.7} />
      </button>
    </header>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div>
      <dt className="text-[11px] text-text-3">{label}</dt>
      <dd className="text-text-2">
        {value === null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}
