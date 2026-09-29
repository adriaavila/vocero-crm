import type {
  Amenity,
  Currency,
  Operation,
  PaymentMethod,
  PropertyKind,
  PropertyStatus,
} from "@/lib/realty/catalog";

/**
 * DTOs del vertical inmobiliario que viajan por `/api/properties/*` (lado
 * cliente). Aparte de `lib/types.ts` (que es de upstream): todo lo del fork
 * vive en su propio sitio, aquí bajo `lib/realty/`.
 */

export type PropertyDto = {
  id: string;
  operation: Operation;
  kind: PropertyKind;
  title: string;
  hasCustomTitle: boolean;
  price: string;
  currency: Currency;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  zone: string;
  bedrooms: number | null;
  bathrooms: string | null;
  builtArea: string | null;
  lotArea: string | null;
  parking: number | null;
  specs: string;
  amenities: Amenity[];
  acceptedPayments: PaymentMethod[];
  status: PropertyStatus;
  description: string | null;
  archivedAt: string | null;
  photoCount: number;
  coverPhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertyPhotoMime = "image/jpeg" | "image/png" | "image/webp";

export type PropertyPhotoDto = {
  id: string;
  propertyId: string;
  position: number;
  isCover: boolean;
  mime: PropertyPhotoMime;
  byteSize: number;
  width: number | null;
  height: number | null;
  url: string;
};

export type PropertiesListResponse = {
  properties: PropertyDto[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type PropertyDetailResponse = {
  property: PropertyDto;
  photos: PropertyPhotoDto[];
};
