// Q-039 answer: PW005 はい goes to the header link pressed on P12 and P13 alike; without a link (中止) the origin screen.
import { leaveTarget } from "@/components/booking/leave-target";

describe("leaveTarget", () => {
  it("the link pressed wins over the draft's origin (P12 used to go to the origin)", () => {
    expect(leaveTarget("/doctors", "/mypage", "/mypage")).toBe("/doctors");
  });
  it("no link (中止 button): the discard answer, else the origin", () => {
    expect(leaveTarget(null, "/clinics", "/mypage")).toBe("/clinics");
    expect(leaveTarget(null, undefined, "/mypage")).toBe("/mypage");
  });
});
