// Q-039 answer: after PW005 はい the user goes to the header link pressed (P11–P13); the 中止 button has no link and
// goes to the origin screen of the draft (the server's answer of /api/booking/discard, else the origin held by the page).
export const leaveTarget = (linkPressed: string | null, discardTo: string | undefined, origin: string) => linkPressed ?? discardTo ?? origin;
