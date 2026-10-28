// api/overpass.js
export default async function handler(req, res) {
  // Allow requests from your frontend domain
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { data } = req.query;
  if (!data) {
    return res.status(400).json({ error: "Missing data query parameter" });
  }

  const mirrors = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];

  for (const base of mirrors) {
    try {
      const response = await fetch(`${base}?data=${encodeURIComponent(data)}`, {
        headers: {
          "User-Agent": "FSI-Zamboanga-App/1.0", // Required by Overpass
          "Referer": "https://fsizc.vercel.app/", // Required by Overpass
          "Accept": "application/json",
        },
      });

      if (response.ok) {
        const json = await response.json();
        return res.status(200).json(json);
      }
    } catch (err) {
      // Try next mirror
    }
  }

  return res.status(500).json({ error: "All Overpass mirrors failed" });
}