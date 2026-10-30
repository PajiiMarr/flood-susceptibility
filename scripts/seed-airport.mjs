// scripts/seed-airports.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const AIRPORTS_QUERY = `
  [out:json][timeout:60];
  ( rel(3617877); );
  map_to_area -> .zamboangaCityArea;
  (
    node["aeroway"~"aerodrome|airport"](area.zamboangaCityArea);
    way["aeroway"~"aerodrome|airport"](area.zamboangaCityArea);
  );
  out body geom;
  >;
  out skel qt;
`;

async function fetchOverpass(query, retries = 3, delay = 1500) {
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "FloodMapZamboanga-SeedScript/1.0 (thesis project)",
        },
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, delay * 2 ** i));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay * 2 ** i));
    }
  }
}

function elementsToRows(elements) {
  const rows = [];
  for (const el of elements) {
    let lat, lon;
    if (el.type === "node" && el.lat && el.lon) {
      lat = el.lat;
      lon = el.lon;
    } else if (el.geometry?.[0]) {
      lat = el.geometry[0].lat;
      lon = el.geometry[0].lon;
    } else continue;

    const tags = el.tags || {};
    if (!tags.name && !tags["name:en"]) continue;

    rows.push({
      osm_id: el.id,
      osm_type: el.type,
      name: tags.name || tags["name:en"],
      type: "Airport", // Hardcoded type
      lat,
      lon,
      addr_street: tags["addr:street"] || null,
      addr_city: tags["addr:city"] || "Zamboanga City",
      phone: tags.phone || null,
      website: tags.website || null,
    });
  }
  return rows;
}

async function main() {
  console.log("Fetching airports from Overpass...");
  const data = await fetchOverpass(AIRPORTS_QUERY);
  const rows = elementsToRows(data.elements || []);

  if (rows.length === 0) {
    console.error("No airports returned.");
    process.exit(1);
  }

  const seen = new Set();
  const deduped = rows.filter((r) => {
    const key = `${r.osm_type}-${r.osm_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Found ${deduped.length} airports. Inserting to Supabase...`);

  const { error } = await supabase
    .from("health_facilities")
    .upsert(deduped, { onConflict: "osm_type,osm_id" });

  if (error) {
    console.error("❌ Supabase Error:", error.message);
  } else {
    console.log(`✅ Done. ${deduped.length} airports seeded successfully.`);
  }
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
