import type { KeyboardEvent } from "react";
import { trapTab } from "@/components/ui/ConfirmDialog";

// node test env: fake the three DOM pieces trapTab reads
function press(shiftKey: boolean, active: object, focusables: Array<{ focus: jest.Mock }>) {
  (globalThis as { document?: unknown }).document = { activeElement: active };
  const e = {
    key: "Tab",
    shiftKey,
    preventDefault: jest.fn(),
    currentTarget: { querySelectorAll: () => focusables, contains: (n: unknown) => focusables.includes(n as never) },
  };
  trapTab(e as unknown as KeyboardEvent<HTMLElement>);
  return e.preventDefault;
}

describe("trapTab (item 34, A05 ⑤ focus trap)", () => {
  afterEach(() => delete (globalThis as { document?: unknown }).document);
  const make = () => [{ focus: jest.fn() }, { focus: jest.fn() }, { focus: jest.fn() }];

  it("Tab on the last element wraps to the first", () => {
    const f = make();
    expect(press(false, f[2], f)).toHaveBeenCalled();
    expect(f[0].focus).toHaveBeenCalled();
  });
  it("Shift+Tab on the first element wraps to the last", () => {
    const f = make();
    expect(press(true, f[0], f)).toHaveBeenCalled();
    expect(f[2].focus).toHaveBeenCalled();
  });
  it("Tab in the middle is left to the browser", () => {
    const f = make();
    expect(press(false, f[1], f)).not.toHaveBeenCalled();
  });
  it("focus outside the dialog is pulled back in", () => {
    const f = make();
    expect(press(false, {}, f)).toHaveBeenCalled();
    expect(f[0].focus).toHaveBeenCalled();
  });
});
