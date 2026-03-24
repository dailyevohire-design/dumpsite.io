"use client";
import { useEffect, useRef, useState } from "react";
import { CITY_COORDS } from "@/lib/city-coords";

/**
 * SECURITY: All map pins use city center coordinates from CITY_COORDS.
 * NEVER uses client_address, delivery_latitude, or delivery_longitude.
 */
function getCityCoords(cityName: string): [number, number] {
  const coords = CITY_COORDS[cityName] || CITY_COORDS["Dallas"];
  // Add jitter so multiple jobs in the same city don't stack exactly
  const jitter = (Math.random() - 0.5) * 0.02;
  return [coords.lat + jitter, coords.lng + jitter];
}

interface Job {
  id: string;
  cities?: { name: string };
  yards_needed?: number;
  driver_pay_cents?: number;
  truck_type_needed?: string;
}

interface Props {
  jobs: Job[];
  onSubmitInterest: (jobId: string) => void;
}

export default function MapView({ jobs, onSubmitInterest }: Props) {
  const mapRef = useRef<any>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      const map = L.map(elRef.current!).setView([32.82, -97.1], 9);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      jobs.forEach((job) => {
        const city = job.cities?.name || "Dallas";
        // SECURITY: City center coordinates only — never exact address
        const coords = getCityCoords(city);
        const pay = Math.round((job.driver_pay_cents || 2000) / 100);
        const yards = job.yards_needed || "?";
        const isEndDump = job.truck_type_needed === 'end_dump' || job.truck_type_needed === 'semi_transfer' || (job.yards_needed && job.yards_needed >= 100);
        const truckLabel = isEndDump ? 'End Dump \u00b7 18-Wheeler \u00b7 Tandem' : 'Tandem Only';
        const truckColor = isEndDump ? '#27AE60' : '#888';
        const marker = L.marker(coords).addTo(map);
        marker.bindPopup(
          "<div style='font-family:sans-serif;min-width:190px;'>" +
          "<div style='font-weight:700;font-size:14px;margin-bottom:6px;'>Delivery Job - " + city + "</div>" +
          "<div style='color:#888;font-size:12px;margin-bottom:4px;'>" + yards + " yards needed</div>" +
          "<div style='color:" + truckColor + ";font-size:11px;margin-bottom:6px;'>\uD83D\uDE9B " + truckLabel + "</div>" +
          "<div style='color:#F5A623;font-weight:700;font-size:22px;margin-bottom:12px;'>$" + pay + " / load</div>" +
          "<button id='btn-" + job.id + "' style='background:#F5A623;color:#111;border:none;padding:9px 0;border-radius:7px;cursor:pointer;font-weight:800;width:100%;font-size:13px;'>Submit Interest</button>" +
          "</div>"
        );
        marker.on("popupopen", () => {
          setTimeout(() => {
            const btn = document.getElementById("btn-" + job.id);
            if (btn) btn.onclick = () => onSubmitInterest(job.id);
          }, 100);
        });
      });
    }).catch(() => { setMapError(true); });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [jobs]);

  if (mapError) {
    return (
      <div style={{
        background: '#111316', border: '1px solid #272B33', borderRadius: '12px',
        padding: '40px', textAlign: 'center', fontFamily: 'system-ui',
      }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>{'\uD83D\uDDFA\uFE0F'}</div>
        <div style={{ fontWeight: '700', fontSize: '16px', color: '#E8E3DC', marginBottom: '8px' }}>
          Map unavailable
        </div>
        <div style={{ fontSize: '13px', color: '#606670', marginBottom: '20px' }}>
          View available jobs in the Jobs tab
        </div>
        <button
          onClick={() => onSubmitInterest(jobs[0]?.id || '')}
          style={{
            background: '#F5A623', color: '#111', border: 'none',
            padding: '10px 24px', borderRadius: '8px',
            fontWeight: '700', cursor: 'pointer', fontSize: '14px',
          }}
        >
          Go to Jobs
        </button>
      </div>
    );
  }

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={elRef} style={{ height: "580px", width: "100%", borderRadius: "12px", overflow: "hidden" }} />
    </>
  );
}
