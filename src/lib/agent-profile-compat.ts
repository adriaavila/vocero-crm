import { z } from "zod";

export function compatibleActivation(value: unknown) {
  const presetReplies = (Array.isArray(value) ? value : [])
    .map((item) =>
      typeof item === "string"
        ? { message: item, response: "" }
        : {
            message: String((item as { message?: unknown })?.message ?? ""),
            response: String((item as { response?: unknown })?.response ?? ""),
          }
    )
    .filter((item) => item.message);
  return {
    activationMessages: presetReplies.map((item) => item.message),
    presetReplies,
  };
}

export const agentProfilePutSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(60).optional(),
    tone: z.string().max(500).nullable().optional(),
    instructions: z.string().max(8000).nullable().optional(),
    escalationRules: z.string().max(4000).nullable().optional(),
    greeting: z.string().max(1000).nullable().optional(),
    activationEnabled: z.boolean().optional(),
    activationMessages: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    allowlistEnabled: z.boolean().optional(),
    allowedWaIds: z
      .array(
        z
          .string()
          .trim()
          .regex(/^\+?\d{7,15}$/, "usa formato internacional, solo dígitos")
          .transform((value) => value.replace(/^\+/, ""))
      )
      .max(100)
      .optional(),
    aiProvider: z.enum(["openai", "openrouter"]).optional(),
    presetOnly: z.boolean().optional(),
    presetReplies: z
      .array(
        z.object({
          message: z.string().trim().min(1).max(500),
          response: z.string().max(4000),
        })
      )
      .max(50)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.allowlistEnabled && data.allowedWaIds?.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedWaIds"],
        message: "agrega al menos un número autorizado",
      });
    }
  })
  .transform(({ presetOnly, presetReplies, ...data }) => {
    const activationEnabled = data.activationEnabled ?? presetOnly;
    const activationMessages =
      data.activationMessages ?? presetReplies?.map((item) => item.message);
    return {
      ...data,
      ...(activationEnabled === undefined ? {} : { activationEnabled }),
      ...(activationMessages === undefined ? {} : { activationMessages }),
      ...(data.allowedWaIds === undefined
        ? {}
        : { allowedWaIds: [...new Set(data.allowedWaIds)] }),
    };
  });
