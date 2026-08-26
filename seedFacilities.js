// seedFacilities.js
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Get current directory (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, ".env") });

// Initialize Supabase client with service role key for admin access
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing environment variables. Please check your .env file.");
  console.error("Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  console.error("Current directory:", __dirname);
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// OpenStreetMap Overpass API endpoints
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Nominatim geocoding endpoint (free, but rate-limited)
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Manual override coordinates for facilities that consistently fail to geocode.
// Add entries here as you discover them (e.g. by checking Google Maps once).
// Key should match the OSM/derived facility name as closely as possible (case-insensitive, trimmed).
const MANUAL_OVERRIDES = {
  // "Zamboanga Doctors' Hospital": { lat: 6.9114, lon: 122.0790 },
  // "Camp Navarro General Hospital": { lat: 6.9075, lon: 122.0730 },
};

// Facility queries for pharmacies and hospitals only
const FACILITY_QUERIES = {
  Pharmacy: `
    [out:json][timeout:60];
    (
      node["amenity"="pharmacy"](6.85,121.85,7.30,122.20);
      node["shop"="chemist"](6.85,121.85,7.30,122.20);
      way["amenity"="pharmacy"](6.85,121.85,7.30,122.20);
      way["shop"="chemist"](6.85,121.85,7.30,122.20);
      relation["amenity"="pharmacy"](6.85,121.85,7.30,122.20);
      relation["shop"="chemist"](6.85,121.85,7.30,122.20);
    );
    out body;
    >;
    out skel qt;
  `,
  Hospital: `
    [out:json][timeout:60];
    (
      node["amenity"="hospital"](6.85,121.85,7.30,122.20);
      node["amenity"="clinic"](6.85,121.85,7.30,122.20);
      node["healthcare"="hospital"](6.85,121.85,7.30,122.20);
      node["healthcare"="clinic"](6.85,121.85,7.30,122.20);
      node["amenity"="doctors"](6.85,121.85,7.30,122.20);
      node["amenity"="healthcare"](6.85,121.85,7.30,122.20);
      node["medical"="hospital"](6.85,121.85,7.30,122.20);

      way["amenity"="hospital"](6.85,121.85,7.30,122.20);
      way["amenity"="clinic"](6.85,121.85,7.30,122.20);
      way["healthcare"="hospital"](6.85,121.85,7.30,122.20);
      way["healthcare"="clinic"](6.85,121.85,7.30,122.20);
      way["amenity"="doctors"](6.85,121.85,7.30,122.20);

      relation["amenity"="hospital"](6.85,121.85,7.30,122.20);
      relation["amenity"="clinic"](6.85,121.85,7.30,122.20);
      relation["healthcare"="hospital"](6.85,121.85,7.30,122.20);
      relation["healthcare"="clinic"](6.85,121.85,7.30,122.20);
    );
    out body;
    >;
    out skel qt;
  `,
};

// Combined query for pharmacies and hospitals only
const FALLBACK_QUERY = `
  [out:json][timeout:120];
  (
    // Pharmacies
    node["amenity"="pharmacy"](6.85,121.85,7.30,122.20);
    node["shop"="chemist"](6.85,121.85,7.30,122.20);
    way["amenity"="pharmacy"](6.85,121.85,7.30,122.20);
    way["shop"="chemist"](6.85,121.85,7.30,122.20);

    // Hospitals and clinics (comprehensive)
    node["amenity"="hospital"](6.85,121.85,7.30,122.20);
    node["amenity"="clinic"](6.85,121.85,7.30,122.20);
    node["amenity"="doctors"](6.85,121.85,7.30,122.20);
    node["amenity"="healthcare"](6.85,121.85,7.30,122.20);
    node["healthcare"="hospital"](6.85,121.85,7.30,122.20);
    node["healthcare"="clinic"](6.85,121.85,7.30,122.20);
    node["medical"="hospital"](6.85,121.85,7.30,122.20);
    way["amenity"="hospital"](6.85,121.85,7.30,122.20);
    way["amenity"="clinic"](6.85,121.85,7.30,122.20);
    way["healthcare"="hospital"](6.85,121.85,7.30,122.20);
    way["healthcare"="clinic"](6.85,121.85,7.30,122.20);
  );
  out body;
  >;
  out skel qt;
`;

// Small delay helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalize curly quotes -> straight quotes, trim whitespace
function cleanText(s) {
  return s ? s.replace(/[\u2018\u2019]/g, "'").trim() : s;
}

// Check manual override map (case-insensitive match on name)
function getManualOverride(name) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  for (const [key, coords] of Object.entries(MANUAL_OVERRIDES)) {
    if (key.trim().toLowerCase() === target) {
      return coords;
    }
  }
  return null;
}

// Try a single Nominatim query, return {lat, lon} or null
async function tryNominatim(query) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.append("q", query);
  url.searchParams.append("format", "json");
  url.searchParams.append("limit", "1");
  url.searchParams.append("bounded", "1");
  url.searchParams.append("viewbox", "121.85,6.85,122.20,7.30");
  url.searchParams.append("addressdetails", "0");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "flood-susceptibility-map-seeder/1.0 (contact: marmanonog07@gmail.com)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data && data.length > 0) {
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }
  return null;
}

// Geocode a facility using a ladder of progressively looser queries.
// Returns { lat, lon, approximate, source } or null.
async function geocodeFacility(name, type, address, city) {
  name = cleanText(name);
  address = cleanText(address);
  city = cleanText(city) || "Zamboanga City";

  // 1. Manual override takes priority (instant, no network call)
  const override = getManualOverride(name);
  if (override) {
    console.log(`  📌 Using manual override for "${name}": ${override.lat}, ${override.lon}`);
    return { lat: override.lat, lon: override.lon, approximate: false, source: "manual" };
  }

  // 2. Build a ladder of queries, most specific first.
  //    NOTE: deliberately NOT appending "pharmacy"/"hospital" as a trailing word —
  //    Nominatim treats free-text search as literal token matching, and that
  //    trailing word frequently prevents otherwise-correct matches.
  const attempts = [];

  if (address) {
    attempts.push({ q: `${name}, ${address}, ${city}, Philippines`, approximate: false });
  }
  attempts.push({ q: `${name}, ${city}, Philippines`, approximate: false });

  // Drop the business name — many small clinics/pharmacies aren't indexed by name,
  // but their street usually is. This is a coarser (street-level) result.
  if (address) {
    attempts.push({ q: `${address}, ${city}, Philippines`, approximate: true });
  }

  // Last resort: short form without "Philippines" suffix
  attempts.push({ q: `${name}, ${city}`, approximate: true });

  for (let i = 0; i < attempts.length; i++) {
    const { q, approximate } = attempts[i];
    console.log(`  🔍 Geocoding attempt ${i + 1}/${attempts.length}: "${q}"`);

    try {
      const result = await tryNominatim(q);
      if (result) {
        console.log(
          `  ✅ Geocoded "${name}" to: ${result.lat}, ${result.lon}${
            approximate ? " (approximate — street/city level)" : ""
          }`,
        );
        return { ...result, approximate, source: "nominatim" };
      }
    } catch (error) {
      console.log(`  ⚠️  Geocoding error on attempt ${i + 1} for "${name}": ${error.message}`);
    }

    // Respect Nominatim's 1 req/sec rate limit between attempts
    if (i < attempts.length - 1) {
      await sleep(1100);
    }
  }

  console.log(`  ⚠️  No geocoding results for "${name}" after all attempts`);
  return null;
}

// Helper function to fetch data from Overpass API
async function fetchOverpassData(query, attempt = 0) {
  const url = OVERPASS_MIRRORS[attempt];
  if (!url) {
    console.error("  ❌ All Overpass mirrors failed for this query.");
    return [];
  }
  try {
    console.log(
      `  🌐 Fetching from ${url} (attempt ${attempt + 1}/${OVERPASS_MIRRORS.length})...`,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/plain, */*",
        "User-Agent":
          "flood-susceptibility-map-seeder/1.0 (contact: marmanonog07@gmail.com)",
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `  ❌ Response error from ${url}:`,
        errorText.substring(0, 200),
      );
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (attempt > 0) {
      console.log(`   ✅ Succeeded using fallback mirror: ${url}`);
    }
    return data.elements || [];
  } catch (error) {
    const causeInfo = error.cause
      ? error.cause.code || error.cause.message || error.cause
      : null;
    console.error(
      `  ⚠️  ${url} failed: ${error.message}${causeInfo ? " (" + causeInfo + ")" : ""}`,
    );
    // Try the next mirror in the list
    return fetchOverpassData(query, attempt + 1);
  }
}

// Categorize elements into Pharmacy or Hospital only
function categorizeElement(tags) {
  // Check for pharmacies
  if (tags.amenity === "pharmacy" || tags.shop === "chemist") {
    return "Pharmacy";
  }
  // Check for hospitals - comprehensive detection
  if (
    tags.amenity === "hospital" ||
    tags.amenity === "clinic" ||
    tags.amenity === "doctors" ||
    tags.amenity === "healthcare" ||
    tags.healthcare === "hospital" ||
    tags.healthcare === "clinic" ||
    tags.medical === "hospital" ||
    (tags.healthcare && tags.healthcare.includes("hospital")) ||
    (tags.amenity && tags.amenity.includes("hospital"))
  ) {
    return "Hospital";
  }
  return null;
}

// Extract facility information from OSM element
function extractFacilityInfo(element, type) {
  const tags = element.tags || {};

  // Get name with fallbacks
  const name =
    tags.name ||
    tags["name:en"] ||
    tags["alt_name"] ||
    `${type} - ${element.id}`;

  // Get address information
  const addrStreet = tags["addr:street"] || null;
  const addrCity = tags["addr:city"] || tags["addr:municipality"] || null;
  const addrHousenumber = tags["addr:housenumber"] || null;

  // Combine street address if house number exists
  let fullStreet = addrStreet;
  if (addrHousenumber && addrStreet) {
    fullStreet = `${addrHousenumber} ${addrStreet}`;
  } else if (addrHousenumber) {
    fullStreet = addrHousenumber;
  }

  // Get contact information
  const phone = tags.phone || tags["contact:phone"] || null;
  const website =
    tags.website || tags["contact:website"] || tags["url"] || null;

  // Additional facility details
  const openingHours = tags["opening_hours"] || null;
  const wheelchair = tags.wheelchair || null;

  // Extract lat/lon - handle ways and relations that might not have direct coordinates
  let lat = null;
  let lon = null;
  if (element.lat !== undefined && element.lat !== null) {
    // Node element with direct coordinates
    lat = element.lat;
    lon = element.lon;
  } else if (element.center) {
    // Way or relation with center point
    lat = element.center.lat;
    lon = element.center.lon;
  } else if (element.bounds) {
    // Use center of bounds
    lat = (element.bounds.minlat + element.bounds.maxlat) / 2;
    lon = (element.bounds.minlon + element.bounds.maxlon) / 2;
  }

  return {
    osm_id: element.id.toString(),
    osm_type: element.type || "node",
    name: name,
    type: type,
    lat: lat,
    lon: lon,
    addr_street: fullStreet || null,
    addr_city: addrCity || null,
    phone: phone,
    website: website,
    opening_hours: openingHours,
    wheelchair: wheelchair,
    fetched_at: new Date().toISOString(),
    needs_geocoding: lat === null || lon === null, // Flag for facilities that need geocoding
    approximate_location: false, // will be set true if geocoded via a fallback query
  };
}

// Fetch pharmacies and hospitals only
async function fetchAllFacilities() {
  console.log("🔄 Fetching facilities from OpenStreetMap...");
  console.log(
    "📍 Searching within Zamboanga City bounds (6.85-7.30 lat, 121.85-122.20 lon)",
  );
  console.log("🎯 Types: Pharmacy, Hospital");
  console.log(
    "🏥 Enhanced hospital queries included (clinics, doctors, healthcare)",
  );

  const allFacilities = [];
  const errors = [];
  let totalFound = 0;
  let skippedNoCoords = 0;
  let needsGeocoding = [];

  // Try individual queries first to get better type separation
  console.log("\n📋 Fetching facilities by type...");
  for (const [type, query] of Object.entries(FACILITY_QUERIES)) {
    console.log(`\n📋 Fetching ${type}...`);
    try {
      const elements = await fetchOverpassData(query);
      console.log(`   Found ${elements.length} raw elements for ${type}`);

      // Filter and categorize elements
      const facilities = elements
        .map((el) => {
          const categorizedType = categorizeElement(el.tags || {});
          // If the element matches the expected type or we need to force categorize
          if (categorizedType === type) {
            return extractFacilityInfo(el, type);
          } else if (
            categorizedType &&
            type === "Hospital" &&
            (categorizedType === "Hospital" ||
              (el.tags &&
                (el.tags.amenity === "clinic" ||
                  el.tags.amenity === "doctors" ||
                  el.tags.healthcare === "clinic")))
          ) {
            // Force categorize healthcare facilities as hospitals
            return extractFacilityInfo(el, "Hospital");
          }
          return null;
        })
        .filter(Boolean);

      // Separate facilities with and without coordinates
      const withCoords = facilities.filter(
        (f) => f.lat !== null && f.lon !== null,
      );
      const withoutCoords = facilities.filter(
        (f) => f.lat === null || f.lon === null,
      );

      if (withoutCoords.length > 0) {
        console.log(`   ⚠️  ${withoutCoords.length} ${type}(s) need geocoding`);
        needsGeocoding.push(...withoutCoords);
      }

      console.log(`   ✅ ${withCoords.length} ${type}(s) with coordinates`);
      totalFound += withCoords.length;
      allFacilities.push(...withCoords);

      // Track how many were skipped (no coords and no geocoding yet)
      skippedNoCoords += withoutCoords.length;
    } catch (error) {
      console.error(`   ❌ Error fetching ${type}:`, error.message);
      errors.push({ type, error: error.message });
    }
  }

  // If no facilities found, try the combined query
  if (allFacilities.length === 0 && needsGeocoding.length === 0) {
    console.log(
      "\n⚠️  No facilities found in individual queries, trying combined query...",
    );
    try {
      const elements = await fetchOverpassData(FALLBACK_QUERY);
      console.log(`   Found ${elements.length} raw elements in combined query`);

      const facilities = elements
        .map((el) => {
          const type = categorizeElement(el.tags || {});
          return type ? extractFacilityInfo(el, type) : null;
        })
        .filter(Boolean);

      const withCoords = facilities.filter(
        (f) => f.lat !== null && f.lon !== null,
      );
      const withoutCoords = facilities.filter(
        (f) => f.lat === null || f.lon === null,
      );

      allFacilities.push(...withCoords);
      needsGeocoding.push(...withoutCoords);
      totalFound += withCoords.length;
      skippedNoCoords += withoutCoords.length;
    } catch (error) {
      console.error("Error in combined query:", error.message);
    }
  }

  // Geocode facilities without coordinates
  if (needsGeocoding.length > 0) {
    console.log(
      `\n🌐 Geocoding ${needsGeocoding.length} facilities without coordinates...`,
    );
    console.log(
      "   (Using Nominatim - free but rate-limited, 1 request per second)",
    );

    let geocodedCount = 0;
    let approximateCount = 0;
    let failedCount = 0;
    const stillFailed = [];

    for (let i = 0; i < needsGeocoding.length; i++) {
      const facility = needsGeocoding[i];

      // Add a delay to respect Nominatim's rate limit between facilities
      if (i > 0) {
        await sleep(1000);
      }

      const result = await geocodeFacility(
        facility.name,
        facility.type,
        facility.addr_street,
        facility.addr_city,
      );

      if (result) {
        facility.lat = result.lat;
        facility.lon = result.lon;
        facility.approximate_location = !!result.approximate;
        allFacilities.push(facility);
        geocodedCount++;
        if (result.approximate) approximateCount++;
      } else {
        failedCount++;
        stillFailed.push(facility.name);
      }

      // Show progress every 10 facilities
      if ((i + 1) % 10 === 0 || i === needsGeocoding.length - 1) {
        console.log(
          `   Progress: ${i + 1}/${needsGeocoding.length} (${geocodedCount} successful, ${failedCount} failed)`,
        );
      }
    }

    console.log(`\n📊 Geocoding Summary:`);
    console.log(`   ✅ Successfully geocoded: ${geocodedCount}`);
    console.log(`      ↳ of which approximate (street/city level): ${approximateCount}`);
    console.log(`   ❌ Failed to geocode: ${failedCount}`);
    if (stillFailed.length > 0) {
      console.log(`\n   Facilities still missing coordinates (consider MANUAL_OVERRIDES):`);
      stillFailed.forEach((n) => console.log(`     - ${n}`));
    }
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} facility type(s) had errors.`);
    errors.forEach((e) => console.log(`   - ${e.type}: ${e.error}`));
  }

  console.log(`\n✅ Total facilities fetched: ${allFacilities.length}`);
  if (skippedNoCoords > 0) {
    console.log(`⚠️  ${skippedNoCoords} facilities were missing coordinates initially`);
  }

  return allFacilities;
}

// Remove duplicates based on OSM ID and name
function deduplicateFacilities(facilities) {
  const seen = new Set();
  const unique = [];
  for (const facility of facilities) {
    // Create a unique key using OSM ID and name
    const key = `${facility.osm_id}-${facility.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(facility);
    }
  }
  console.log(
    `\n🗑️  Removed ${facilities.length - unique.length} duplicate(s)`,
  );
  return unique;
}

// Seed facilities to Supabase
async function seedFacilities(facilities) {
  console.log(`\n💾 Seeding ${facilities.length} facilities to Supabase...`);

  let inserted = 0;
  let errors = 0;

  // Process in batches of 50 to avoid rate limits
  const batchSize = 50;
  for (let i = 0; i < facilities.length; i += batchSize) {
    const batch = facilities.slice(i, i + batchSize);

    // Remove the needs_geocoding flag before seeding (it's not in the database schema).
    // Keep approximate_location only if your table has that column — otherwise strip it too.
    const cleanBatch = batch.map(({ needs_geocoding, ...rest }) => rest);

    try {
      // Use upsert with onConflict to avoid duplicates
      const { data, error } = await supabase
        .from("health_facilities")
        .upsert(cleanBatch, {
          onConflict: "osm_id, osm_type",
          ignoreDuplicates: false,
        })
        .select();

      if (error) {
        console.error(
          `❌ Error seeding batch ${Math.floor(i / batchSize) + 1}:`,
          error.message,
        );
        errors += batch.length;
      } else {
        inserted += batch.length;
        console.log(
          `   ✅ Batch ${Math.floor(i / batchSize) + 1} seeded (${batch.length} records)`,
        );
      }
    } catch (error) {
      console.error(
        `❌ Error with batch ${Math.floor(i / batchSize) + 1}:`,
        error.message,
      );
      errors += batch.length;
    }
  }

  console.log(`\n📊 Seeding Summary:`);
  console.log(`   ✅ Inserted/Updated: ${inserted} facilities`);
  console.log(`   ❌ Errors: ${errors} facilities`);
}

// Export to Excel file
function exportToExcel(facilities) {
  try {
    const data = facilities.map((f) => ({
      "OSM ID": f.osm_id,
      "OSM Type": f.osm_type,
      Name: f.name,
      Type: f.type,
      Latitude: f.lat,
      Longitude: f.lon,
      Address: f.addr_street,
      City: f.addr_city,
      Phone: f.phone,
      Website: f.website,
      "Opening Hours": f.opening_hours,
      "Wheelchair Access": f.wheelchair,
      Approximate: f.approximate_location ? "Yes" : "No",
      "Fetched At": f.fetched_at,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Facilities");

    const filename = `facilities_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const filepath = path.join(__dirname, filename);
    XLSX.writeFile(wb, filepath);

    console.log(`\n📊 Exported ${facilities.length} facilities to ${filename}`);
    return filepath;
  } catch (error) {
    console.error("❌ Error exporting to Excel:", error.message);
    return null;
  }
}

// Main function
async function main() {
  console.log("🚀 Starting OpenStreetMap Facility Seeder");
  console.log("=========================================\n");

  console.log("📂 Working directory:", __dirname);
  console.log("📄 Checking for .env file...");

  // Check if .env file exists
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env file not found at:", envPath);
    process.exit(1);
  }
  console.log("✅ .env file found!\n");

  try {
    // Step 1: Fetch facilities from OSM
    let facilities = await fetchAllFacilities();

    // Step 2: Deduplicate
    facilities = deduplicateFacilities(facilities);

    if (facilities.length === 0) {
      console.log(
        "\n⚠️  No facilities found in the area. The Overpass API might be rate-limited.",
      );
      console.log(
        "   Try again in a few minutes, or check if the API is accessible.",
      );
      return;
    }

    // Step 3: Show sample of first 5 facilities
    console.log("\n📝 Sample of fetched facilities:");
    facilities.slice(0, 5).forEach((f, i) => {
      console.log(`   ${i + 1}. ${f.name} (${f.type}) - ${f.lat}, ${f.lon}`);
    });
    if (facilities.length > 5) {
      console.log(`   ... and ${facilities.length - 5} more`);
    }

    // Show a breakdown by type
    const counts = facilities.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {});
    console.log("\n📊 Breakdown by type:");
    Object.entries(counts).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    // Show a breakdown of approximate vs exact coordinates
    const approxCount = facilities.filter((f) => f.approximate_location).length;
    if (approxCount > 0) {
      console.log(`\n📍 ${approxCount} facilities have approximate (street/city-level) coordinates.`);
      console.log(`   Review these in the Excel export ("Approximate" column) before relying on them for precise routing.`);
    }

    // Step 4: Export to Excel for review
    const excelPath = exportToExcel(facilities);
    if (!excelPath) {
      console.log("⚠️  Continuing without Excel export...");
    }

    // Step 5: Ask for confirmation before seeding
    console.log("\n⚠️  You are about to seed facilities to Supabase.");
    console.log(`   Total: ${facilities.length} facilities`);
    console.log("   Press Enter to continue, or Ctrl+C to cancel...");

    // Wait for user input (if running in interactive mode)
    if (process.stdin.isTTY) {
      await new Promise((resolve) => {
        process.stdin.once("data", () => resolve());
      });
    }

    // Step 6: Seed to Supabase
    await seedFacilities(facilities);

    console.log("\n✅ Seeding completed successfully!");
    console.log(`📁 Excel export saved to: ${excelPath || "Not created"}`);
  } catch (error) {
    console.error("\n❌ Unexpected error:", error.message);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});