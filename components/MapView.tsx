"use client";
import { useEffect, useRef } from "react";

const CITY_COORDS: Record<string, [number, number]> = {
  "Fort Worth": [32.7555, -97.3308],
  "Dallas": [32.7767, -96.7970],
  "Arlington": [32.7357, -97.1081],
  "Colleyville": [32.8890, -97.1503],
  "Lake Worth": [32.8021, -97.4378],
  "Grapevine": [32.9343, -97.0781],
  "Southlake": [32.9412, -97.1336],
  "Keller": [32.9343, -97.2294],
  "Mansfield": [32.5632, -97.1417],
  "Euless": [32.8371, -97.0819],
  "Irving": [32.8140, -96.9489],
  "Plano": [33.0198, -96.6989],
  "Frisco": [33.1507, -96.8236],
  "Denton": [33.2148, -97.1331],
  "Lewisville": [33.0462, -97.0641],
  "Carrollton": [32.9537, -96.8903],
};

function getCoords(cityName: string): [number, number] {
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (cityName && cityName.toLowerCase().includes(key.toLowerCase())) return coords;
  }
  return [32.78 + (Math.random() - 0.5) * 0.2, -97.0 + (Math.random() - 0.5) * 0.2];
}

interface Job {
  id: string;
  cities?: { name: string };
  yards_needed?: number;
  price_quoted_cents?: number;
}

interface Props {
  jobs: Job[];
  onSubmitInterest: (jobId: string) => void;
}

export default function MapView({ jobs, onSubmitInterest }: Props) {
  const mapRef = useRef<any>(null);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      const map = L.map(elRef.current!).setView([32.8, -97.0], 10);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      jobs.forEach((job) => {
        const city = job.cities?.name || "DFW";
        const coords = getCoords(city);
        const pay = job.price_quoted_cents ? "$" + (job.price_quoted_cents / 100).toFixed(0) : "$23";
        const yards = job.yards_needed || "?";
        const marker = L.marker(coords).addTo(map);
        marker.bindPopup(
          "<div style='font-family:sans-serif;min-width:190px;'>" +
          "<div style='font-weight:700;font-size:14px;margin-bottom:6px;'>Delivery Job - " + city + "</div>" +
          "<div style='color:#888;font-size:12px;margin-bottom:4px;'>" + yards + " yards needed</div>" +
          "<div style='color:#F5A623;font-weight:700;font-size:18px;margin-bottom:12px;'>" + pay + " / load</div>" +
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
    });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [jobs]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={elRef} style={{ height: "580px", width: "100%", borderRadius: "12px", overflow: "hidden" }} />
    </>
  );
}
