"use client";
import { useEffect, useRef, useState } from "react";

const CITY_COORDS: Record<string, [number, number]> = {
  "Dallas": [32.7767, -96.7970],
  "Fort Worth": [32.7555, -97.3308],
  "Irving": [32.8140, -96.9489],
  "Arlington": [32.7357, -97.1081],
  "Grand Prairie": [32.7460, -97.0228],
  "Plano": [33.0198, -96.6989],
  "Garland": [32.9126, -96.6389],
  "Mesquite": [32.7668, -96.5992],
  "Denton": [33.2148, -97.1331],
  "McKinney": [33.1972, -96.6397],
  "Houston": [29.7604, -95.3698],
  "Austin": [30.2672, -97.7431],
  "Cleburne": [32.3479, -97.3886],
  "Ferris": [32.5335, -96.6644],
  "Midlothian": [32.4821, -97.0050],
  "Azle": [32.8957, -97.5467],
  "Cedar Hill": [32.5885, -96.9561],
  "Mansfield": [32.5632, -97.1417],
  "Colleyville": [32.8890, -97.1503],
  "Haslet": [32.9657, -97.3467],
  "Justin": [33.0851, -97.2947],
  "Lake Worth": [32.8021, -97.4378],
  "Everman": [32.6312, -97.2895],
  "Venus": [32.4307, -97.1003],
  "Princeton": [33.1776, -96.4997],
  "Little Elm": [33.1629, -96.9375],
  "Godley": [32.4457, -97.5267],
  "Joshua": [32.4618, -97.3886],
  "Terrell": [32.7362, -96.2752],
  "Denison": [33.7557, -96.5364],
  "Mabank": [32.3668, -96.1044],
  "Alvarado": [32.4068, -97.2142],
  "Kaufman": [32.5893, -96.3058],
  "Carthage": [32.1571, -94.3391],
  "DeSoto": [32.5896, -96.8572],
  "Covington": [32.1746, -97.2561],
  "Hillsboro": [32.0126, -97.1267],
  "Hutchins": [32.6418, -96.7133],
  "Ponder": [33.1918, -97.2869],
  "Gordonville": [33.8074, -96.8536],
  "Matador": [34.0112, -100.8237],
  "Rockwall": [32.9290, -96.4597],
  "Hutto": [30.5427, -97.5491],
  "Bonham": [33.5762, -96.1769],
  "Carrollton": [32.9537, -96.8903],
  "Jimmy": [32.7555, -97.3308],
};

function addFuzz(coords: [number, number]): [number, number] {
  const angle = Math.random() * 2 * Math.PI;
  const radius = Math.random() * 0.055;
  return [coords[0] + radius * Math.cos(angle), coords[1] + radius * Math.sin(angle)];
}

function getCoords(cityName: string): [number, number] {
  if (!cityName) return addFuzz([32.78, -97.05]);
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (cityName.toLowerCase().includes(key.toLowerCase())) return addFuzz(coords);
  }
  return addFuzz([32.78, -97.05]);
}

interface Job {
  id: string;
  cities?: { name: string };
  yards_needed?: number;
  driver_pay_cents?: number;
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
        const city = job.cities?.name || "DFW";
        const coords = getCoords(city);
        const pay = Math.round((job.driver_pay_cents || 2000) / 100);
        const yards = job.yards_needed || "?";
        const marker = L.marker(coords).addTo(map);
        marker.bindPopup(
          "<div style='font-family:sans-serif;min-width:190px;'>" +
          "<div style='font-weight:700;font-size:14px;margin-bottom:6px;'>Delivery Job - " + city + "</div>" +
          "<div style='color:#888;font-size:12px;margin-bottom:4px;'>" + yards + " yards needed</div>" +
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
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>🗺️</div>
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
