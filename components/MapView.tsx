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
  "Mesquite": [32.7668, -96.5992],
  "Grand Prairie": [32.7460, -97.0228],
  "McKinney": [33.1972, -96.6397],
  "Allen": [33.1032, -96.6706],
  "Flower Mound": [33.0145, -97.0964],
  "North Richland Hills": [32.8343, -97.2289],
  "Haltom City": [32.7993, -97.2697],
  "Hurst": [32.8232, -97.1883],
  "Bedford": [32.8440, -97.1430],
  "Watauga": [32.8582, -97.2550],
  "Saginaw": [32.8596, -97.3619],
  "Azle": [32.8957, -97.5467],
  "Benbrook": [32.6818, -97.4625],
  "Burleson": [32.5421, -97.3208],
  "Crowley": [32.5793, -97.3622],
  "Cleburne": [32.3479, -97.3886],
  "Cedar Hill": [32.5885, -96.9561],
  "Duncanville": [32.6518, -96.9083],
  "DeSoto": [32.5896, -96.8572],
  "Lancaster": [32.5921, -96.7561],
  "Rowlett": [32.9029, -96.5638],
  "Sachse": [32.9751, -96.5802],
  "Wylie": [33.0151, -96.5388],
  "Rockwall": [32.9290, -96.4597],
  "Weatherford": [32.7596, -97.7975],
  "Midlothian": [32.4821, -97.0050],
  "Waxahachie": [32.3868, -96.8489],
  "Coppell": [32.9543, -97.0150],
  "Farmers Branch": [32.9268, -96.8961],
  "Addison": [32.9612, -96.8291],
  "Richardson": [32.9483, -96.7299],
  "Garland": [32.9126, -96.6389],
};

function getCoords(cityName: string): [number, number] {
  if (!cityName) return addFuzz([32.78, -97.05]);
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (cityName.toLowerCase().includes(key.toLowerCase())) return addFuzz(coords);
  }
  return addFuzz([32.78, -97.05]);
}

function addFuzz(coords: [number, number]): [number, number] {
  // ~5 mile radius fuzz (0.072 degrees ≈ 5 miles)
  const angle = Math.random() * 2 * Math.PI;
  const radius = Math.random() * 0.055;
  return [coords[0] + radius * Math.cos(angle), coords[1] + radius * Math.sin(angle)];
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

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      const map = L.map(elRef.current!).setView([32.82, -97.1], 10);
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
