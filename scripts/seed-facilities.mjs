// scripts/seed-facilities.mjs
// Fetches Zamboanga City health facilities from Overpass and upserts them
// into the Supabase `health_facilities` table.
// Usage: npx dotenv -e .env -- node scripts/seed-facilities.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PRIMARY_QUERY = `
  [out:json][timeout:60];
  ( rel(3617877); );
  map_to_area -> .zamboangaCityArea;
  (
    node["amenity"="pharmacy"](area.zamboangaCityArea);
    node["amenity"="hospital"](area.zamboangaCityArea);
    node["healthcare"="hospital"](area.zamboangaCityArea);
    way["amenity"="pharmacy"](area.zamboangaCityArea);
    way["amenity"="hospital"](area.zamboangaCityArea);
    way["healthcare"="hospital"](area.zamboangaCityArea);
  );
  out body geom;
  >;
  out skel qt;
`;

const FALLBACK_QUERY = `
  [out:json][timeout:60];
  ( rel(3617877); );
  map_to_area -> .zamboangaCityArea;
  (
    node["amenity"="clinic"](area.zamboangaCityArea);
    node["amenity"="doctors"](area.zamboangaCityArea);
    node["healthcare"="clinic"](area.zamboangaCityArea);
    node["healthcare"="doctor"](area.zamboangaCityArea);
    way["amenity"="clinic"](area.zamboangaCityArea);
    way["amenity"="doctors"](area.zamboangaCityArea);
    way["healthcare"="clinic"](area.zamboangaCityArea);
    way["healthcare"="doctor"](area.zamboangaCityArea);
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
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      if (data.remark?.includes("runtime error")) {
        throw new Error(`Overpass error: ${data.remark}`);
      }
      return data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay * 2 ** i));
    }
  }
}

function deriveType(tags) {
  if (tags.amenity === "pharmacy" || tags.healthcare === "pharmacy") return "Pharmacy";
  if (tags.amenity === "hospital" || tags.healthcare === "hospital") return "Hospital";
  if (tags.amenity === "clinic" || tags.healthcare === "clinic") return "Clinic";
  if (tags.amenity === "doctors" || tags.healthcare === "doctor") return "Medical Office";
  return tags.amenity || tags.healthcare || "Facility";
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
    } else {
      continue;
    }

    const tags = el.tags || {};
    rows.push({
      osm_id: el.id,
      osm_type: el.type,
      name: tags.name || deriveType(tags),
      type: deriveType(tags),
      lat,
      lon,
      addr_street: tags["addr:street"] || null,
      addr_city: tags["addr:city"] || null,
      phone: tags.phone || null,
      website: tags.website || null,
    });
  }
  return rows;
}

async function main() {
  let data = await fetchOverpass(PRIMARY_QUERY);
  let rows = elementsToRows(data.elements || []);

  if (rows.length === 0) {
    data = await fetchOverpass(FALLBACK_QUERY);
    rows = elementsToRows(data.elements || []);
  }

  if (rows.length === 0) {
    console.error("No facilities returned from Overpass.");
    process.exit(1);
  }

  // De-duplicate by (osm_type, osm_id) in case node/way results overlap
  const seen = new Set();
  const deduped = rows.filter((r) => {
    const key = `${r.osm_type}-${r.osm_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Batch upsert — requires a unique constraint on (osm_type, osm_id)
  const BATCH_SIZE = 200;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("health_facilities")
      .upsert(batch, { onConflict: "osm_type,osm_id" });

    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error.message);
      process.exit(1);
    }
  }

  console.log(`Done. ${deduped.length} facilities seeded.`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});