import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { findServiceArea } from "./service-areas";

export type Env = {
  DB: D1Database;
  DISPATCHER_API_KEY: string;
};

const areaCodeSchema = z
  .object({
    areaCode: z.string().regex(/^\d{3}$/, "areaCode must be exactly three digits")
  })
  .strict();

const bookingSchema = z
  .object({
    areaCode: z.string().regex(/^\d{3}$/, "areaCode must be exactly three digits"),
    slotId: z.string().trim().min(1, "slotId is required"),
    name: z.string().trim().min(2, "name is required"),
    phone: z.string().regex(/^\d{10}$/, "phone must be a 10-digit NANP number"),
    symptom: z.string().trim().min(3, "symptom is required")
  })
  .strict();

type Booking = z.infer<typeof bookingSchema> & {
  confirmation: string;
  slotLabel: string;
  bookedAt: string;
};

const app = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

app.use("*", async (context, next) => {
  await next();
  context.header("Cache-Control", "no-store");
  context.header("X-Content-Type-Options", "nosniff");
});

app.get("/health", (context) =>
  context.json({ ok: true, service: "voice-ai-dispatcher" })
);

const vapiDashboardCors = cors({
  origin: "https://dashboard.vapi.ai",
  allowHeaders: ["Content-Type", "X-Dispatcher-Key"],
  allowMethods: ["POST", "OPTIONS"],
  maxAge: 86_400
});

app.use("/service-availability", vapiDashboardCors);
app.use("/appointments", vapiDashboardCors);

const requireApiKey: MiddlewareHandler<{ Bindings: Env }> = async (
  context,
  next
) => {
  const suppliedKey = context.req.header("X-Dispatcher-Key");

  if (!suppliedKey || suppliedKey !== context.env.DISPATCHER_API_KEY) {
    return context.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid API key" } },
      401
    );
  }

  await next();
};

app.use("/service-availability", requireApiKey);
app.use("/appointments", requireApiKey);

app.post("/service-availability", async (context) => {
  const body = await parseJson(context);
  if (!body.ok) return body.response;

  const parsed = areaCodeSchema.safeParse(body.value);
  if (!parsed.success) return validationError(context, parsed.error);

  const { areaCode } = parsed.data;
  const area = findServiceArea(areaCode);

  console.log(
    JSON.stringify({ event: "service_area_lookup", areaCode, serviced: area.serviced })
  );

  return context.json({
    ok: true,
    serviced: area.serviced,
    areaCode,
    region: area.region,
    slots: area.slots
  });
});

app.post("/appointments", async (context) => {
  const body = await parseJson(context);
  if (!body.ok) return body.response;

  const parsed = bookingSchema.safeParse(body.value);
  if (!parsed.success) return validationError(context, parsed.error);

  const request = parsed.data;
  const area = findServiceArea(request.areaCode);

  if (!area.serviced) {
    return context.json(
      {
        ok: false,
        error: {
          code: "AREA_NOT_SERVICED",
          message: `Area code ${request.areaCode} is not serviced`
        }
      },
      409
    );
  }

  const selectedSlot = area.slots.find((slot) => slot.id === request.slotId);
  if (!selectedSlot) {
    return context.json(
      {
        ok: false,
        error: {
          code: "SLOT_NOT_AVAILABLE",
          message: `Slot ${request.slotId} is not available for area code ${request.areaCode}`
        }
      },
      409
    );
  }

  const booking: Booking = {
    ...request,
    confirmation: createConfirmation(),
    slotLabel: selectedSlot.label,
    bookedAt: new Date().toISOString()
  };

  await saveBooking(context.env.DB, booking);

  console.log(
    JSON.stringify({
      event: "appointment_booked",
      confirmation: booking.confirmation,
      areaCode: booking.areaCode,
      slotId: booking.slotId,
      phoneLast4: booking.phone.slice(-4)
    })
  );

  return context.json(
    {
      ok: true,
      appointment: {
        confirmation: booking.confirmation,
        areaCode: booking.areaCode,
        slotId: booking.slotId,
        label: booking.slotLabel
      }
    },
    201
  );
});

app.notFound((context) =>
  context.json(
    { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } },
    404
  )
);

app.onError((error, context) => {
  console.error(JSON.stringify({ event: "unhandled_error", message: error.message }));

  return context.json(
    {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Unable to complete request" }
    },
    500
  );
});

async function parseJson(context: AppContext) {
  try {
    return { ok: true as const, value: await context.req.json<unknown>() };
  } catch {
    return {
      ok: false as const,
      response: context.json(
        {
          ok: false,
          error: { code: "INVALID_JSON", message: "Request body must be valid JSON" }
        },
        400
      )
    };
  }
}

function validationError(context: AppContext, error: z.ZodError) {
  return context.json(
    {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Request body failed validation",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    },
    400
  );
}

function createConfirmation(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return `HVAC-${String(10_000 + (random % 90_000))}`;
}

async function saveBooking(database: D1Database, booking: Booking): Promise<void> {
  await database
    .prepare(
      `INSERT INTO appointments (
        confirmation,
        area_code,
        slot_id,
        slot_label,
        customer_name,
        phone,
        symptom,
        booked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      booking.confirmation,
      booking.areaCode,
      booking.slotId,
      booking.slotLabel,
      booking.name,
      booking.phone,
      booking.symptom,
      booking.bookedAt
    )
    .run();
}

export default app;

