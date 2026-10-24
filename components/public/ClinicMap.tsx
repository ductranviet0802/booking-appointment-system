"use client";
// demo add-on: map, not in ver1 spec. OpenStreetMap tiles through Leaflet (bundled, no key, no cookies, no geolocation).
// Offline the tiles fail quietly: a grey box with the pins; the address stays on the page beside it.
// leaflet.css is imported by app/layout.tsx.
import { useEffect, useRef } from "react";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export type MapPin = { code: string; name: string; lat: number; lng: number; href?: string };

/** pins with an `href` open it on click; `selected` is drawn filled (P11) */
export function ClinicMap({ pins, lang, selected, className = "" }: { pins: MapPin[]; lang: Lang; selected?: string | null; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(pins) + (selected ?? "");

  useEffect(() => {
    if (!box.current || pins.length === 0) return;
    let map: import("leaflet").Map | null = null;
    let alive = true;
    import("leaflet").then(({ default: L }) => {
      if (!alive || !box.current) return;
      map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      map.attributionControl.setPrefix(false);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);
      for (const p of pins) {
        const on = selected === p.code || pins.length === 1;
        const m = L.circleMarker([p.lat, p.lng], { radius: on ? 10 : 8, color: "#08625e", weight: 2, fillColor: on ? "#0b7a75" : "#ffffff", fillOpacity: 1 })
          .addTo(map)
          // names stay on in the list maps; the small P11 map (a `selected` prop) shows them on hover
          .bindTooltip(p.name, { direction: "top", offset: [0, -8], permanent: pins.length > 1 && selected === undefined });
        if (p.href) m.on("click", () => window.location.assign(p.href!));
      }
      if (pins.length === 1) map.setView([pins[0].lat, pins[0].lng], 16);
      else map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [48, 48] });
    });
    return () => {
      alive = false;
      map?.remove();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pins.length === 0) return null;
  return <div ref={box} className={`clinic-map ${className}`} role="region" aria-label={label("mapAria", lang)} data-testid="clinic-map" />;
}
