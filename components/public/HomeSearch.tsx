"use client";
// spec-screen: P01
// Items 5, 5-1, 6 (event 4): trims the keyword and opens P08; `keyword` is left out when empty (Q6 b).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { KEYWORD_MAX, trimKeyword } from "@/lib/public/keyword";

/** a paste is cut at 50 characters, counted after trimming (leading spaces stay while typing) */
export function cutKeyword(raw: string) {
  if (Array.from(trimKeyword(raw)).length <= KEYWORD_MAX) return raw;
  const lead = /^[\s　]*/.exec(raw)?.[0] ?? "";
  return lead + Array.from(raw.slice(lead.length)).slice(0, KEYWORD_MAX).join("");
}

export function HomeSearch({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const go = () => {
    const kw = trimKeyword(value);
    router.push(kw ? `/doctors?${new URLSearchParams({ keyword: kw }).toString()}` : "/doctors");
  };
  return (
    <form
      className="flex flex-col gap-2"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><span className="hidden md:inline-flex"><Icon name="search" /></span>{label("doctorsHeading", lang)}</h2>
      <div className="flex flex-col gap-2 md:flex-row">
        <input
          className="inp"
          type="search"
          name="keyword"
          value={value}
          placeholder={label("kwPlaceholder", lang)}
          aria-label={label("keyword", lang)}
          aria-describedby="kw-help"
          autoComplete="off"
          onChange={(e) => setValue(cutKeyword(e.target.value))}
          // Enter must not search while an IME conversion is open (Q6 a)
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
          }}
        />
        <button type="submit" className="btn bs md:bp">
          <Icon name="search" />
          {label("findDoctor", lang)}
        </button>
      </div>
      <p id="kw-help" className="m-0 hidden text-sm text-[color:var(--mut)] md:block">{label("kwHelp", lang)}</p>
    </form>
  );
}
