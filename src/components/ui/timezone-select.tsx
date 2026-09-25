"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TimezoneOption = { value: string; label: string };

/**
 * Zonas horarias IANA con etiqueta en español. Orden: LATAM primero (el
 * público principal de Vocero), luego EE. UU. y España. El valor guardado
 * sigue siendo el string IANA que valida `isValidTimeZone`.
 */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: "America/La_Paz", label: "La Paz (Bolivia)" },
  { value: "America/Caracas", label: "Caracas (Venezuela)" },
  { value: "America/Bogota", label: "Bogotá (Colombia)" },
  { value: "America/Lima", label: "Lima (Perú)" },
  { value: "America/Guayaquil", label: "Guayaquil (Ecuador)" },
  { value: "America/Mexico_City", label: "Ciudad de México (México centro)" },
  { value: "America/Cancun", label: "Cancún (México)" },
  { value: "America/Tijuana", label: "Tijuana (México)" },
  { value: "America/Santiago", label: "Santiago (Chile)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (Argentina)" },
  { value: "America/Montevideo", label: "Montevideo (Uruguay)" },
  { value: "America/Asuncion", label: "Asunción (Paraguay)" },
  { value: "America/Sao_Paulo", label: "São Paulo (Brasil)" },
  { value: "America/Panama", label: "Panamá" },
  { value: "America/Costa_Rica", label: "Costa Rica" },
  { value: "America/Guatemala", label: "Guatemala" },
  { value: "America/El_Salvador", label: "El Salvador" },
  { value: "America/Tegucigalpa", label: "Honduras" },
  { value: "America/Managua", label: "Nicaragua" },
  { value: "America/Santo_Domingo", label: "República Dominicana" },
  { value: "America/Puerto_Rico", label: "Puerto Rico" },
  { value: "America/New_York", label: "Nueva York (EE. UU. este)" },
  { value: "America/Chicago", label: "Chicago (EE. UU. centro)" },
  { value: "America/Denver", label: "Denver (EE. UU. montaña)" },
  { value: "America/Los_Angeles", label: "Los Ángeles (EE. UU. Pacífico)" },
  { value: "Europe/Madrid", label: "Madrid (España)" },
];

/**
 * Devuelve la lista de opciones, agregando el valor guardado al final si no
 * está en la lista curada. Así nunca se cambia en silencio un valor ya
 * guardado (por ejemplo, uno escrito a mano antes de este selector).
 */
export function getTimezoneOptions(currentValue?: string): TimezoneOption[] {
  if (
    currentValue &&
    !TIMEZONE_OPTIONS.some((tz) => tz.value === currentValue)
  ) {
    return [...TIMEZONE_OPTIONS, { value: currentValue, label: currentValue }];
  }
  return TIMEZONE_OPTIONS;
}

export function TimezoneSelect({
  id,
  value,
  onValueChange,
  className,
  disabled,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const options = getTimezoneOptions(value);
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder="Elige una zona horaria" />
      </SelectTrigger>
      <SelectContent>
        {options.map((tz) => (
          <SelectItem key={tz.value} value={tz.value}>
            {tz.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
