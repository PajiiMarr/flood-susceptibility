import "./LandingPage.css";

const TITLE =
  "ABENIDA: MAPPING HIGH-RESOLUTION FLOOD SUSCEPTIBILITY IN ZAMBOANGA CITY USING SPATIAL MACHINE LEARNING";

// Deterministic wobbly closed contours, drawn like topographic lines.
function contourPath(cx, cy, r, seed) {
  const pts = [];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble =
      1 +
      0.12 * Math.sin(3 * a + seed) +
      0.07 * Math.sin(5 * a + seed * 1.7) +
      0.04 * Math.sin(9 * a + seed * 0.6);
    pts.push(
      `${(cx + Math.cos(a) * r * wobble * 1.35).toFixed(1)},${(
        cy +
        Math.sin(a) * r * wobble
      ).toFixed(1)}`,
    );
  }
  return "M" + pts.join("L") + "Z";
}

const CONTOURS = Array.from({ length: 14 }, (_, i) =>
  contourPath(640, 300, 30 + i * 24, i * 0.35),
);

const METHODS = [
  {
    name: "GWPCA",
    text: "Geographically weighted principal component analysis, applied to the flood factors during preprocessing.",
  },
  {
    name: "GWR",
    text: "Geographically weighted regression with kernel-based local fits and automatic bandwidth selection.",
  },
  {
    name: "MGWR",
    text: "A multiscale variant in which each factor receives its own spatial bandwidth.",
  },
  {
    name: "MARS",
    text: "Multivariate adaptive regression splines, using hinge functions to capture nonlinear thresholds.",
  },
  {
    name: "SVM",
    text: "RBF-kernel support vector machine with tuned hyperparameters and calibrated probabilities.",
  },
  {
    name: "Stacking ensemble",
    text: "Base classifiers combined by a logistic-regression meta-learner.",
  },
];

const FEATURES = [
  {
    title: "Flood inventory from Sentinel-1 SAR",
    text: "Flood maps derived from SAR change detection (difference and NDFI layers) for multiple flood events.",
  },
  {
    title: "Terrain, hydrology and rainfall factors",
    text: "DEM, slope, aspect, TWI, HAND, distance to river, drainage density, flow accumulation, and GPM and CHIRPS rainfall.",
  },
  {
    title: "Model evaluation",
    text: "Accuracy, precision, recall, F1, Cohen’s kappa, ROC-AUC, RMSE and MAE, with cross-validation.",
  },
  {
    title: "Susceptibility risk classes",
    text: "Model predictions are grouped into risk classes and displayed on the flood susceptibility map.",
  },
];

export default function LandingPage({ onEnterMap }) {
  return (
    <div className="lp">
      <header className="lp-hero">
        <svg
          className="lp-contours"
          viewBox="0 0 1280 600"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          {CONTOURS.map((d, i) => (
            <path key={i} d={d} className={i % 5 === 0 ? "lp-index" : ""} />
          ))}
        </svg>

        <div className="lp-wrap lp-hero-inner">
          <p className="lp-place">Zamboanga City, Philippines</p>
          <h1 className="lp-title">{TITLE}</h1>

          {/* Added Proponents Names */}
          <p
            style={{
              fontSize: "1rem",
              fontWeight: "500",
              color: "var(--text-muted, #64748b)",
              marginTop: "0.5rem",
              marginBottom: "1.5rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Balagosa &bull; Manon-og &bull; Brillantes
          </p>

          <p className="lp-lede">
            ABENIDA maps where Zamboanga City is most prone to flooding. It
            combines satellite-derived flood records, terrain, hydrology and
            rainfall data with spatial machine learning models to estimate flood
            susceptibility at high resolution.
          </p>
          <div className="lp-cta">
            <button type="button" className="lp-btn" onClick={onEnterMap}>
              Open the flood susceptibility map
            </button>
            <a
              className="lp-link"
              href="#methodology"
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById("methodology")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Read the methodology
            </a>
          </div>
          <div
            className="lp-ramp"
            role="img"
            aria-label="Susceptibility scale from low to high"
          >
            <span>Low</span>
            <i />
            <span>High</span>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-section" id="overview">
          <div className="lp-wrap lp-two">
            <h2>Project overview</h2>
            <div>
              <p>
                Floods in Zamboanga City vary sharply from one neighbourhood to
                the next, shaped by elevation, proximity to rivers, drainage and
                rainfall. Models that assume one relationship across the whole
                city miss that variation.
              </p>
              <p>
                This project uses geographically weighted and machine learning
                methods to let those relationships change across space, and
                presents the resulting susceptibility surface on a map.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-section lp-tint" id="methodology">
          <div className="lp-wrap">
            <h2>Methodology</h2>
            <p className="lp-sub">
              Models implemented in the project’s training pipeline.
            </p>
            <dl className="lp-grid">
              {METHODS.map((m) => (
                <div className="lp-item" key={m.name}>
                  <dt>{m.name}</dt>
                  <dd>{m.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-wrap">
            <h2>Key features</h2>
            <dl className="lp-grid lp-grid-2">
              {FEATURES.map((f) => (
                <div className="lp-item" key={f.title}>
                  <dt>{f.title}</dt>
                  <dd>{f.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-wrap">
            <button type="button" className="lp-btn" onClick={onEnterMap}>
              Open the flood susceptibility map
            </button>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          {/* Added Proponents Names to Footer */}
          <p
            style={{
              fontWeight: "600",
              marginBottom: "0.25rem",
              color: "var(--text-main, #0f172a)",
            }}
          >
            Balagosa, Manon-og, Brillantes
          </p>
          <p>
            Thesis project. Zamboanga City flood susceptibility mapping using
            spatial machine learning.
          </p>
        </div>
      </footer>
    </div>
  );
}
