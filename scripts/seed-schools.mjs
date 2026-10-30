// scripts/seed-schools.mjs
// Fetches Zamboanga City schools/universities from Overpass and upserts them
// into the Supabase `health_facilities` table.
// Usage: node scripts/seed-schools.mjs

import "dotenv/config"; // <-- ADDED THIS LINE TO LOAD .env AUTOMATICALLY
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SCHOOLS_QUERY = `
  [out:json][timeout:60];
  ( rel(3617877); );
  map_to_area -> .zamboangaCityArea;
  (
    node["amenity"~"school|university|college"](area.zamboangaCityArea);
    way["amenity"~"school|university|college"](area.zamboangaCityArea);
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

function deriveSchoolType(tags) {
  if (tags.amenity === "university" || tags.amenity === "college")
    return "University";
  return "School";
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
    if (!tags.name && !tags["name:en"]) continue;

    rows.push({
      osm_id: el.id,
      osm_type: el.type,
      name: tags.name || tags["name:en"],
      type: deriveSchoolType(tags),
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
  console.log("Fetching schools from Overpass...");
  const data = await fetchOverpass(SCHOOLS_QUERY);
  const rows = elementsToRows(data.elements || []);

  if (rows.length === 0) {
    console.error("No schools returned from Overpass.");
    process.exit(1);
  }

  const seen = new Set();
  const deduped = rows.filter((r) => {
    const key = `${r.osm_type}-${r.osm_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(
    `Found ${deduped.length} unique schools. Inserting to Supabase...`,
  );

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

  console.log(`✅ Done. ${deduped.length} schools seeded successfully.`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
