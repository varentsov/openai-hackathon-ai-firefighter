export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CorePath Incident Console</title>
    <style>
      :root {
        --bg: #f4efe7;
        --panel: rgba(255, 250, 242, 0.96);
        --text: #1c1a16;
        --muted: #5d564d;
        --border: rgba(28, 26, 22, 0.14);
        --alert: #b33a2f;
        --alert-deep: #7a211a;
        --good: #1d6b4d;
        --accent: #d99f43;
        --shadow: 0 18px 50px rgba(76, 50, 28, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(217, 159, 67, 0.26), transparent 28%),
          radial-gradient(circle at top right, rgba(179, 58, 47, 0.18), transparent 25%),
          linear-gradient(180deg, #f9f4eb 0%, var(--bg) 48%, #efe5d7 100%);
      }

      .shell {
        max-width: 1200px;
        margin: 0 auto;
        padding: 24px;
      }

      .banner {
        display: grid;
        gap: 16px;
        padding: 24px;
        border-radius: 24px;
        background: linear-gradient(135deg, var(--alert) 0%, var(--alert-deep) 100%);
        color: #fff8f1;
        box-shadow: var(--shadow);
      }

      .banner h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3.6rem);
        letter-spacing: -0.04em;
      }

      .banner p {
        margin: 0;
        max-width: 70ch;
        color: rgba(255, 248, 241, 0.88);
      }

      .banner-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        cursor: pointer;
        transition: transform 140ms ease, opacity 140ms ease;
      }

      button:hover {
        transform: translateY(-1px);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        transform: none;
      }

      .primary {
        background: #fff5e7;
        color: var(--alert-deep);
      }

      .secondary {
        background: rgba(255, 255, 255, 0.18);
        color: #fff8f1;
        border: 1px solid rgba(255, 248, 241, 0.2);
      }

      .grid {
        display: grid;
        gap: 18px;
        margin-top: 22px;
      }

      .grid.two {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }

      .grid.four {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 20px;
        box-shadow: var(--shadow);
      }

      .card h2,
      .card h3 {
        margin: 0 0 12px;
        font-size: 1.05rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .metric-value {
        font-size: 2rem;
        letter-spacing: -0.04em;
      }

      .muted {
        color: var(--muted);
      }

      .actions {
        display: grid;
        gap: 12px;
      }

      .action {
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.68);
      }

      .action.highlight {
        border-color: rgba(179, 58, 47, 0.45);
        background: rgba(179, 58, 47, 0.07);
      }

      .status-good {
        color: var(--good);
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "SFMono-Regular", ui-monospace, Menlo, monospace;
        font-size: 0.92rem;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="banner">
        <div>
          <div id="alertMeta" class="muted"></div>
          <h1>Checkout latency degradation</h1>
          <p id="alertSummary">Recommendations are pulling the core path out of budget while a recent deploy remains in the suspect window.</p>
        </div>
        <div class="banner-actions">
          <button id="analyzeBtn" class="primary">Analyze</button>
          <button id="executeBtn" class="secondary" disabled>Disable recommendations</button>
        </div>
      </section>

      <section class="grid two">
        <article class="card">
          <h2>Why CorePath Cares</h2>
          <div id="corePathText" class="muted">Loading incident context…</div>
        </article>
        <article class="card">
          <h2>Architecture Links</h2>
          <div id="architectureRefs" class="muted">Loading references…</div>
        </article>
      </section>

      <section class="grid two">
        <article class="card">
          <h2>Ranked Actions</h2>
          <div id="actions" class="actions muted">Run analysis to rank the next action.</div>
        </article>
        <article class="card">
          <h2>Evidence</h2>
          <pre id="evidence">Analyze the incident to see logs, commit suspects, and rollback guidance.</pre>
        </article>
      </section>

      <section class="grid four">
        <article class="card">
          <h3>Checkout P95</h3>
          <div class="metric-value" id="checkoutP95">--</div>
          <div class="muted" id="checkoutP95State">before</div>
        </article>
        <article class="card">
          <h3>Checkout Error Rate</h3>
          <div class="metric-value" id="checkoutErrors">--</div>
          <div class="muted" id="checkoutErrorState">before</div>
        </article>
        <article class="card">
          <h3>Recommendations P95</h3>
          <div class="metric-value" id="recsP95">--</div>
          <div class="muted" id="recsP95State">before</div>
        </article>
        <article class="card">
          <h3>Worker Saturation</h3>
          <div class="metric-value" id="workers">--</div>
          <div class="muted" id="workersState">before</div>
        </article>
      </section>

      <section class="grid two">
        <article class="card">
          <h2>Final Status</h2>
          <div id="finalStatus" class="muted">Core path is still under investigation.</div>
        </article>
        <article class="card">
          <h2>Trace Timeline</h2>
          <pre id="traces">No trace events yet.</pre>
        </article>
      </section>
    </main>

    <script>
      const state = {
        traceId: undefined,
      };

      const elements = {
        alertMeta: document.getElementById("alertMeta"),
        corePathText: document.getElementById("corePathText"),
        architectureRefs: document.getElementById("architectureRefs"),
        actions: document.getElementById("actions"),
        evidence: document.getElementById("evidence"),
        checkoutP95: document.getElementById("checkoutP95"),
        checkoutP95State: document.getElementById("checkoutP95State"),
        checkoutErrors: document.getElementById("checkoutErrors"),
        checkoutErrorState: document.getElementById("checkoutErrorState"),
        recsP95: document.getElementById("recsP95"),
        recsP95State: document.getElementById("recsP95State"),
        workers: document.getElementById("workers"),
        workersState: document.getElementById("workersState"),
        finalStatus: document.getElementById("finalStatus"),
        traces: document.getElementById("traces"),
        analyzeBtn: document.getElementById("analyzeBtn"),
        executeBtn: document.getElementById("executeBtn"),
      };

      function renderMetrics(metrics, stage) {
        elements.checkoutP95.textContent = metrics.checkoutP95Ms + "ms";
        elements.checkoutP95State.textContent = stage;
        elements.checkoutErrors.textContent = (metrics.checkoutErrorRate * 100).toFixed(1) + "%";
        elements.checkoutErrorState.textContent = stage;
        elements.recsP95.textContent = metrics.recommendationsP95Ms + "ms";
        elements.recsP95State.textContent = stage;
        elements.workers.textContent = (metrics.workerSaturation * 100).toFixed(0) + "%";
        elements.workersState.textContent = stage;
      }

      function renderTraceEvents(events) {
        if (!events.length) {
          elements.traces.textContent = "No trace events yet.";
          return;
        }

        elements.traces.textContent = events
          .map((event) => {
            return "[" + event.timestamp + "] " + event.step + "\\n" +
              "  in: " + event.inputSummary + "\\n" +
              "  out: " + event.outputSummary;
          })
          .join("\\n\\n");
      }

      async function loadState() {
        const response = await fetch("/api/demo-state");
        const data = await response.json();
        elements.alertMeta.textContent =
          data.incident.service + " / " + data.incident.symptom + " / " + data.incident.severity + " / started " + data.incident.startedAt;
        elements.corePathText.textContent =
          data.metricsSource === "prometheus_mock_sre_lab"
            ? "Checkout is the protected journey. Metrics are coming from live mock-sre-lab Prometheus data" +
              (data.activeFaults?.length ? " with active faults: " + data.activeFaults.join(", ") + "." : ".")
            : "Checkout is the protected journey. Recommendations stay degradable while rollback guidance remains available as the next recommendation.";
        elements.architectureRefs.textContent = data.architectureReferences.join(", ");
      }

      async function loadTraces() {
        const response = await fetch("/api/traces");
        const data = await response.json();
        renderTraceEvents(data.events || []);
      }

      elements.analyzeBtn.addEventListener("click", async () => {
        elements.analyzeBtn.disabled = true;
        const response = await fetch("/api/analyze", { method: "POST" });
        const data = await response.json();
        state.traceId = data.traceId;
        renderMetrics(data.metrics.before, "before");
        elements.actions.innerHTML = "";

        [data.bestFirstAction, ...data.nextActions].forEach((action, index) => {
          const node = document.createElement("article");
          node.className = "action" + (index === 0 ? " highlight" : "");
          node.innerHTML =
            "<strong>" + action.title + "</strong><br />" +
            action.reason + "<br /><span class='muted'>Tradeoff: " + action.expectedTradeoff + "</span>";
          elements.actions.appendChild(node);
        });

        elements.evidence.textContent =
          "Annotation: " + data.annotation.summary + "\\n\\n" +
          "Suspect commit: " + data.suspectCommit.sha + " - " + data.suspectCommit.summary + "\\n" +
          "Rollback target: " + data.rollbackPlan.targetSha + " (" + data.rollbackPlan.mode + ")\\n\\n" +
          "Logs:\\n" +
          data.logs.map((log) => "- [" + log.level + "] " + log.message).join("\\n") + "\\n\\n" +
          "Commits:\\n" +
          data.commits.map((commit) => "- " + commit.sha + " " + commit.summary).join("\\n");
        elements.finalStatus.textContent = data.why;
        elements.executeBtn.disabled = false;
        await loadTraces();
        elements.analyzeBtn.disabled = false;
      });

      elements.executeBtn.addEventListener("click", async () => {
        elements.executeBtn.disabled = true;
        const response = await fetch("/api/actions/disable-recommendations", { method: "POST" });
        const data = await response.json();
        renderMetrics(data.metrics.after, "after");
        elements.finalStatus.textContent = data.summary;
        await loadTraces();
      });

      loadState();
      loadTraces();
    </script>
  </body>
</html>`;
}
