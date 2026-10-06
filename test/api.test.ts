import { beforeEach, describe, expect, it } from "vitest";
import app, { type Env } from "../src/index";

const TEST_API_KEY = "test_only_key";

type StoredBooking = {
  confirmation: string;
  areaCode: string;
  slotId: string;
  slotLabel: string;
  name: string;
  phone: string;
  symptom: string;
  bookedAt: string;
};

class FakeDatabase {
  bookings: StoredBooking[] = [];

  prepare() {
    return {
      bind: (...values: string[]) => ({
        run: async () => {
          this.bookings.push({
            confirmation: values[0]!,
            areaCode: values[1]!,
            slotId: values[2]!,
            slotLabel: values[3]!,
            name: values[4]!,
            phone: values[5]!,
            symptom: values[6]!,
            bookedAt: values[7]!
          });
          return { success: true };
        }
      })
    };
  }
}

let database: FakeDatabase;
let env: Env;

beforeEach(() => {
  database = new FakeDatabase();
  env = {
    DB: database as unknown as D1Database,
    DISPATCHER_API_KEY: TEST_API_KEY
  };
});

function post(path: string, body: unknown, key = TEST_API_KEY) {
  return app.request(
    path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dispatcher-Key": key
      },
      body: JSON.stringify(body)
    },
    env
  );
}

describe("authentication", () => {
  it("rejects an unknown API key", async () => {
    const response = await post("/service-availability", { areaCode: "514" }, "wrong");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" }
    });
  });

  it("rejects a missing API key", async () => {
    const response = await app.request(
      "/service-availability",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCode: "514" })
      },
      env
    );
    expect(response.status).toBe(401);
  });
});

describe("Vapi dashboard preflight", () => {
  it("allows the dashboard to test authenticated POST tools", async () => {
    const response = await app.request(
      "/service-availability",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://dashboard.vapi.ai",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-dispatcher-key"
        }
      },
      env
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://dashboard.vapi.ai"
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-Dispatcher-Key"
    );
  });
});

describe("POST /service-availability", () => {
  it.each([
    ["514", "Montreal"],
    ["438", "Greater Montreal"]
  ])("returns serviceable slots for %s", async (areaCode, region) => {
    const response = await post("/service-availability", { areaCode });
    const body = await response.json<{
      serviced: boolean;
      region: string;
      slots: Array<{ id: string; label: string }>;
    }>();

    expect(response.status).toBe(200);
    expect(body.serviced).toBe(true);
    expect(body.region).toBe(region);
    expect(body.slots).toHaveLength(2);
    expect(body.slots.every((slot) => slot.id && slot.label)).toBe(true);
  });

  it("returns an unsupported area with no slots", async () => {
    const response = await post("/service-availability", { areaCode: "212" });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      serviced: false,
      areaCode: "212",
      region: null,
      slots: []
    });
  });

  it.each(["+1514", "5145550142", "51A"])(
    "rejects malformed area code %s",
    async (areaCode) => {
      const response = await post("/service-availability", { areaCode });
      expect(response.status).toBe(400);
    }
  );
});

describe("POST /appointments", () => {
  const validBooking = {
    areaCode: "514",
    slotId: "SLOT-MON-AM",
    name: "Alex Morgan",
    phone: "5145550142",
    symptom: "AC blowing warm air"
  };

  it("persists a valid appointment and returns its generated confirmation", async () => {
    const response = await post("/appointments", validBooking);
    const body = await response.json<{
      appointment: { confirmation: string; label: string };
    }>();

    expect(response.status).toBe(201);
    expect(body.appointment.confirmation).toMatch(/^HVAC-\d{5}$/);
    expect(body.appointment.label).toBe("Monday 8:00am–12:00pm");
    expect(database.bookings).toHaveLength(1);
    expect(database.bookings[0]).toMatchObject({
      confirmation: body.appointment.confirmation,
      name: "Alex Morgan",
      slotId: "SLOT-MON-AM"
    });
  });

  it("refuses to book an unserviced area", async () => {
    const response = await post("/appointments", {
      ...validBooking,
      areaCode: "212"
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AREA_NOT_SERVICED" }
    });
    expect(database.bookings).toHaveLength(0);
  });

  it("refuses an unknown slot", async () => {
    const response = await post("/appointments", {
      ...validBooking,
      slotId: "SLOT-NOT-REAL"
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SLOT_NOT_AVAILABLE" }
    });
  });

  it("rejects a country code in the phone field", async () => {
    const response = await post("/appointments", {
      ...validBooking,
      phone: "+15145550142"
    });
    expect(response.status).toBe(400);
  });
});

