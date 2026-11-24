import { describe, expect, it } from "vitest";
import { schedulePlace } from "./RoutineScheduleNote";

describe("where a routine runs, said where it is scheduled", () => {
  it("never offers Add a Cloud on This computer; keeps Open the Cloud once paid and ready", () => {
    expect(schedulePlace({ cloudHome: true, local: false, plan: null, ready: false, offersAllowed: true })).toEqual({ kind: "cloud" });
    expect(schedulePlace({ cloudHome: false, local: false, plan: null, ready: false, offersAllowed: true })).toEqual({ kind: "server" });
    expect(schedulePlace({ cloudHome: false, local: true, plan: { kind: "signed-out" }, ready: false, offersAllowed: true })).toEqual({ kind: "local", next: null });
    expect(schedulePlace({ cloudHome: false, local: true, plan: { kind: "free" }, ready: false, offersAllowed: true })).toEqual({ kind: "local", next: null });
    expect(schedulePlace({ cloudHome: false, local: true, plan: { kind: "paid", label: "Pro", checking: false }, ready: true, offersAllowed: true })).toEqual({ kind: "local", next: "open-cloud" });
    expect(schedulePlace({ cloudHome: false, local: true, plan: { kind: "paid", label: "Pro", checking: false }, ready: false, offersAllowed: true })).toEqual({ kind: "local", next: null });
  });
});
