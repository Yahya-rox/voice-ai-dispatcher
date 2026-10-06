export type Slot = {
  id: string;
  label: string;
};

export type ServiceArea = {
  serviced: boolean;
  region: string | null;
  slots: Slot[];
};

export const SERVICE_AREAS: Readonly<Record<string, ServiceArea>> = {
  "514": {
    serviced: true,
    region: "Montreal",
    slots: [
      { id: "SLOT-MON-AM", label: "Monday 8:00am–12:00pm" },
      { id: "SLOT-MON-PM", label: "Monday 1:00pm–5:00pm" }
    ]
  },
  "438": {
    serviced: true,
    region: "Greater Montreal",
    slots: [
      { id: "SLOT-TUE-AM", label: "Tuesday 8:00am–12:00pm" },
      { id: "SLOT-TUE-PM", label: "Tuesday 1:00pm–5:00pm" }
    ]
  },
  "212": {
    serviced: false,
    region: null,
    slots: []
  }
};

export function findServiceArea(areaCode: string): ServiceArea {
  return (
    SERVICE_AREAS[areaCode] ?? {
      serviced: false,
      region: null,
      slots: []
    }
  );
}

