import { useState } from "react";

const tabs = ["Request Flow", "Architecture", "Role Model", "Failure Modes", "Observability", "Security", "API Contract"];

const roles = [
  { id: "developer", label: "Developer", color: "#6366f1", view: "Personal scores, issues found, fix suggestions, growth chart, streak" },
  { id: "senior", label: "Senior Dev / Tech Lead", color: "#d97706", view: "PR queue, pre-screened issues, team scores, review efficiency metrics" },
  { id: "qa", label: "QA Engineer", color: "#dc2626", view: "Risk manifest per build, high-risk files ranked, suggested test focus areas" },
  { id: "devops", label: "DevOps / Cloud", color: "#059669", view: "Pipeline gate status, security score trends, repos drifting below threshold" },
  { id: "cso", label: "CSO / Eng Lead", color: "#7c3aed", view: "Org-wide dashboard, team trends, most improved, weekly digest email" },
];

const layers = [
  {
    label: "External",
    components: [
      {
        id: "github", label: "GitHub", sublabel: "Webhooks + OAuth",
        color: "#1a1a18", textColor: "#fff",
        what: "Source of all events. Sends signed webhook payloads on every push and PR. Owns authentication via OAuth — no DevLens passwords exist.",
        why: "Delegating identity and event sourcing to GitHub eliminates an entire auth system. If GitHub sends it, it happened.",
        tradeoff: "Full dependency on GitHub availability. Acceptable — if GitHub is down, developers cannot push code, so no events are missed.",
        failure: "GitHub down → queue stays empty → system idles safely → recovers automatically when GitHub returns.",
      }
    ]
  },
  {
    label: "Auth + Onboarding",
    components: [
      {
        id: "oauth", label: "GitHub OAuth + Onboarding", sublabel: "JWT issued · primary_role set once",
        color: "#0891b2", textColor: "#fff",
        what: "After GitHub OAuth callback, DevLens checks if the user has a primary_role set. If not — first login — they are redirected to the onboarding screen to pick their role. Once set, never shown again. A JWT is issued containing user_id, org_id, primary_role, and active_role. Active_role starts as primary_role.",
        why: "Capturing primary_role at onboarding means every subsequent request is immediately role-aware without a database lookup. Storing active_role in the JWT means role switching issues a new token — no DB write needed for a session switch.",
        tradeoff: "Role is self-declared — DevLens trusts what the user picks, not what GitHub teams say. Simpler to implement and more flexible for people who wear multiple hats.",
        failure: "Onboarding screen shown → user closes without picking → session ends → shown again on next login. JWT expiry → redirect to GitHub OAuth silently → new JWT issued with last known primary_role.",
      },
      {
        id: "role_switch", label: "Role Switcher", sublabel: "Top nav dropdown · new JWT per switch",
        color: "#6366f1", textColor: "#fff",
        what: "A dropdown in the top navigation bar, always visible. Shows all five roles. Current active_role is highlighted. Selecting a different role calls POST /auth/switch-role, which issues a new JWT with the updated active_role. No page refresh — React updates the view immediately. Last used role remembered for the session, resets to primary_role on new login.",
        why: "A senior dev who pushes code needs the developer view. A DevOps engineer who writes infra code needs their own scores. Rigid single-role systems break for people who wear multiple hats.",
        tradeoff: "Role switching issues a new JWT — adds one API call per switch. Acceptable cost for the flexibility it provides. The old JWT is invalidated immediately on the server side.",
        failure: "Switch fails → user stays on current role → error toast shown → can retry. JWT issued but switch endpoint fails → old token still valid → no broken state.",
      }
    ]
  },
  {
    label: "Ingestion",
    components: [
      {
        id: "webhook", label: "Webhook Receiver", sublabel: "FastAPI · single responsibility",
        color: "#6366f1", textColor: "#fff",
        what: "One endpoint. Receives GitHub event, validates HMAC-SHA256 signature, checks Redis idempotency store to reject duplicates, enqueues job, returns HTTP 200 in under 200ms.",
        why: "Does one thing only — receive, validate, enqueue. Never blocks waiting for analysis. GitHub retries on slow responses, causing duplicate jobs.",
        tradeoff: "If Redis is down, idempotency checks fail open — we accept the job and risk a duplicate analysis. A duplicate review beats a missed security scan.",
        failure: "Signature invalid → 401, job rejected. Redis down → fail open, log warning. Queue full → 503 with retry-after header.",
      },
      {
        id: "idempotency", label: "Idempotency Store", sublabel: "Redis · dedup · 24hr TTL",
        color: "#9333ea", textColor: "#fff",
        what: "Stores commit SHAs with 24-hour TTL. Webhook receiver checks here before enqueuing. SHA exists → duplicate → dropped silently.",
        why: "GitHub retries webhooks on timeout or 5xx. Without dedup a single push creates multiple analysis jobs.",
        tradeoff: "Redis TTL means a SHA older than 24 hours could theoretically trigger re-analysis. In practice this never happens.",
        failure: "Redis restart clears store — brief duplicate risk. Secondary check: PostgreSQL queried for existing results before analysis runs.",
      }
    ]
  },
  {
    label: "Processing",
    components: [
      {
        id: "queue", label: "Job Queue", sublabel: "Redis + RQ · 3 retries · DLQ",
        color: "#dc2626", textColor: "#fff",
        what: "Every push is a job with unique ID, commit SHA, repo, and changed files. Retried 3 times with exponential backoff (30s, 2min, 10min) before Dead Letter Queue. Job states: pending → processing → complete → failed.",
        why: "The queue guarantees no security issue is ever missed under concurrent load. 10–50 developers pushing simultaneously each get their own job — none dropped.",
        tradeoff: "Redis not durable by default. Mitigated by enabling AOF persistence — minor write overhead, crash-safe queue.",
        failure: "Worker crashes → visibility timeout expires → job returns to queue → retried up to 3 times → DLQ → alert fires.",
      },
      {
        id: "worker", label: "Analyser Workers", sublabel: "N=3 concurrent · idempotent",
        color: "#7c3aed", textColor: "#fff",
        what: "Pool of 3 Python workers. Each pulls one job, fetches changed files from GitHub API, calls AI service, scores across 5 dimensions, writes to PostgreSQL, broadcasts via WebSocket. Every operation idempotent — safe to retry.",
        why: "Stateless workers mean concurrent pushes processed in parallel. Can be added, removed, or restarted without coordination.",
        tradeoff: "N=3 balances throughput against HuggingFace free tier rate limits. Tunable config — increase N when moving off free tier.",
        failure: "Worker crashes → job returns to queue. AI timeout after 25s → retry with backoff. No silent failures — every failure logged with job ID.",
      },
      {
        id: "ai", label: "AI Service Layer", sublabel: "HuggingFace primary · local fallback",
        color: "#059669", textColor: "#fff",
        what: "Single Python interface, two implementations. HuggingFaceAnalyser calls inference API with 25s timeout. LocalAnalyser loads model lazily on first fallback. Circuit breaker trips after 3 consecutive HuggingFace failures — routes to local for 5-minute cooldown.",
        why: "Interface abstraction means the worker never changes regardless of which engine runs. Circuit breaker prevents hammering a degraded API.",
        tradeoff: "Local model quality is lower than HuggingFace. Fallback results explicitly flagged as degraded — availability over quality. A degraded scan beats no scan for a security tool.",
        failure: "HuggingFace timeout → retry once → circuit breaker increments → fallback triggers → local model → result flagged degraded. All transitions logged.",
      }
    ]
  },
  {
    label: "Data + Delivery",
    components: [
      {
        id: "db", label: "PostgreSQL", sublabel: "Primary store · row-level tenant isolation",
        color: "#0369a1", textColor: "#fff",
        what: "Stores users (with primary_role), organisations, repos, commits, jobs, scores per dimension, issues per file, and weekly aggregates. Every row carries org_id. Key users table columns: user_id, org_id, github_id, primary_role, created_at.",
        why: "PostgreSQL handles concurrent writes from multiple workers. Row-level tenant isolation means one org can never read another org's data.",
        tradeoff: "Render free tier: 1GB storage limit, sleeps after inactivity. Acceptable for portfolio. Real production needs a managed PostgreSQL service.",
        failure: "Write fails → worker retries 3 times. All fail → DLQ → manual intervention. Transactions used — no partial writes ever.",
      },
      {
        id: "api", label: "REST + WebSocket API", sublabel: "FastAPI · JWT middleware · role-aware responses",
        color: "#6366f1", textColor: "#fff",
        what: "JWT middleware runs before every handler. Decodes token, extracts org_id and active_role, injects both into request context. No handler executes without verified org_id and active_role. REST returns role-filtered data — a developer gets their personal scores, a CSO gets org aggregates. WebSocket pushes live events scoped to org.",
        why: "Role-aware responses at the API layer mean the frontend never has to filter data itself — it receives exactly what the active role needs. Middleware enforcement means auth and role scoping cannot be forgotten on new endpoints.",
        tradeoff: "WebSocket connections drop on server restart. Frontend implements exponential backoff reconnection. In-flight results fetched via REST on reconnect.",
        failure: "JWT expired → 401, redirect to GitHub OAuth. active_role missing from JWT → default to primary_role. WebSocket drops → reconnect with backoff → REST fills gap.",
      }
    ]
  },
  {
    label: "Cross-Cutting",
    components: [
      {
        id: "observability", label: "Observability", sublabel: "Logs · Metrics · Alerts",
        color: "#d97706", textColor: "#fff",
        what: "Structured JSON logs on every job state transition. Five key metrics: end-to-end latency (push → visible on dashboard), queue depth, job processing time p50/p95, AI fallback rate, DLQ count. Alerts when queue > 20, failure rate > 5%, or p95 end-to-end > 28s.",
        why: "End-to-end latency is the metric product cares about — it directly measures the user promise of under 30 seconds. Queue depth and fallback rate explain why latency degrades before users notice.",
        tradeoff: "Full APM tools like Datadog are paid. Using structured stdout logging captured by Render + lightweight metrics endpoint. Good enough for portfolio.",
        failure: "Observability is fire-and-forget — never a failure point. System continues if metrics endpoint is down. Visibility lost temporarily, functionality never.",
      },
      {
        id: "security", label: "Security Layer", sublabel: "Secrets · Rate limiting · Isolation",
        color: "#b45309", textColor: "#fff",
        what: "Four controls: HMAC-SHA256 webhook signature validation. All secrets in environment variables. Rate limiting — 100 req/min per JWT identity, 10 webhook events/min per repo. Row-level org isolation on every query.",
        why: "A tool that finds security vulnerabilities in other people's code must itself be a security exemplar.",
        tradeoff: "Rate limiting in-memory per process — not shared across multiple API instances. Move to Redis counters at scale.",
        failure: "Rate limit exceeded → 429 with retry-after. Invalid signature → 401 logged with IP. Org isolation bug → empty result, never another org's data. Fail closed by design.",
      }
    ]
  },
  {
    label: "Multi-Role Client",
    components: [
      {
        id: "frontend", label: "React Frontend", sublabel: "Vite · 5 role views · session role memory",
        color: "#0891b2", textColor: "#fff",
        what: "Five distinct dashboard views — one per role. Active view determined by active_role from JWT. Role switcher in top nav, always visible. On first login, onboarding screen shown before dashboard. Session remembers last used role. Deployed independently on Vercel free tier.",
        why: "Each role has fundamentally different information needs. A developer needs their own scores. A CSO needs org trends. Serving both from one unified view produces a cluttered tool nobody wants to use.",
        tradeoff: "Five views means five times the frontend work. Mitigated by sharing a common component library — score cards, issue rows, charts — across all views. Only the layout and data queries differ per role.",
        failure: "WebSocket drop → reconnect with backoff → REST fills gap. API unreachable → cached last-known state with stale warning. Token expired → silent GitHub OAuth redirect. Role switch fails → stays on current view with error toast.",
      }
    ]
  }
];

const requestFlowSteps = [
  { step: 1, actor: "Developer", action: "git push origin main", timing: "t = 0s", color: "#6b7280", detail: "Developer pushes code to GitHub. This is the only deliberate action they take — everything from here is automatic and silent." },
  { step: 2, actor: "GitHub", action: "POST /webhook/github", timing: "t ≈ 1s", color: "#1a1a18", detail: "GitHub sends a signed webhook payload within ~1 second. Contains commit SHA, repo name, branch, and list of changed files." },
  { step: 3, actor: "Webhook Receiver", action: "Validate · Dedup · Enqueue", timing: "t ≈ 1.2s", color: "#6366f1", detail: "FastAPI validates HMAC-SHA256 signature — invalid means instant 401. Checks Redis idempotency store — duplicate SHA means silent drop. Passes both → job enqueued → HTTP 200 returned in under 200ms." },
  { step: 4, actor: "Job Queue", action: "Job state: pending → WebSocket notifies", timing: "t ≈ 1.5s", color: "#dc2626", detail: "Job sits safely in Redis queue. WebSocket immediately broadcasts 'analysis started' to the developer's dashboard — they see a live indicator within 2 seconds of pushing." },
  { step: 5, actor: "Analyser Worker", action: "Fetch files → AI analysis", timing: "t ≈ 2s – 25s", color: "#7c3aed", detail: "Worker fetches changed files from GitHub API. Calls AI service — HuggingFace primary, local model fallback. Scores each file across 5 dimensions. AI analysis consumes ~80% of the total time budget." },
  { step: 6, actor: "PostgreSQL", action: "Save results atomically", timing: "t ≈ 25s – 27s", color: "#0369a1", detail: "Worker writes all scores, issues, and metadata in a single transaction. Job state updated to 'complete'. Write fails → retried up to 3 times. No partial results ever stored." },
  { step: 7, actor: "WebSocket", action: "Broadcast completion event", timing: "t ≈ 27s – 28s", color: "#059669", detail: "The moment DB write succeeds, worker broadcasts full result over WebSocket to all connected clients in this org — scoped by org_id from JWT." },
  { step: 8, actor: "React Dashboard", action: "Role-aware results rendered", timing: "t < 30s", color: "#0891b2", detail: "Dashboard receives WebSocket event. Renders the view matching the user's active_role — developer sees their personal scores and issues, senior dev sees it on their PR queue, QA sees the risk manifest. No refresh needed." },
];

const failureModes = [
  { scenario: "Worker crashes mid-analysis", impact: "Medium", response: "Visibility timeout expires → job returns to queue → retried up to 3 times. Developer sees 'processing' until retry completes.", prevention: "Workers emit heartbeat every 10s. Job forcibly returned after 30s silence.", idempotent: true },
  { scenario: "HuggingFace rate limited", impact: "Low", response: "Circuit breaker increments. After 3 failures trips to local model. Result flagged degraded. Yellow indicator shown.", prevention: "N=3 workers stays within free tier rate. Monitor fallback rate metric.", idempotent: true },
  { scenario: "AI call times out (25s)", impact: "Low", response: "Job retried with backoff (30s, 2min, 10min). 3rd failure → DLQ → alert fires.", prevention: "25s timeout set below 30s user expectation — one retry within acceptable window.", idempotent: true },
  { scenario: "Redis restarts", impact: "High", response: "In-flight jobs may be lost. Idempotency store cleared. Workers reconnect. Brief duplicate risk.", prevention: "Redis AOF persistence enabled. PostgreSQL secondary dedup check.", idempotent: false },
  { scenario: "PostgreSQL write fails", impact: "High", response: "Worker retries 3 times. All fail → DLQ → manual intervention. Transactions — no partial writes.", prevention: "Connection pooling. Retry with backoff. Alert on DLQ growth.", idempotent: true },
  { scenario: "WebSocket drops", impact: "Low", response: "Frontend reconnects: 1s → 2s → 4s → 8s. Missed results fetched via REST on reconnect.", prevention: "Server ping every 30s. Frontend shows reconnecting indicator.", idempotent: true },
  { scenario: "Role switch fails", impact: "Low", response: "User stays on current role view. Error toast shown. Can retry immediately.", prevention: "Old JWT remains valid until new one issued — no broken auth state during switch.", idempotent: true },
  { scenario: "First login — onboarding abandoned", impact: "Low", response: "Session ends without primary_role set. Next login redirects to onboarding again. No data lost.", prevention: "Onboarding is a hard redirect — dashboard unreachable without primary_role set.", idempotent: true },
  { scenario: "Queue depth exceeds 20 jobs", impact: "Medium", response: "Alert fires. New webhook responses include 503 with retry-after. GitHub retries. No jobs lost.", prevention: "Monitor queue depth. Scale workers horizontally on sustained load.", idempotent: true },
];

const securityControls = [
  { control: "Webhook signature validation", layer: "Ingestion", detail: "Every inbound webhook validated with HMAC-SHA256. Invalid signature → 401, logged with source IP, job never created." },
  { control: "JWT verified on every request", layer: "API Middleware", detail: "Middleware decodes JWT, extracts org_id and active_role, injects both into request context before any handler runs. Impossible to forget on new endpoints." },
  { control: "Role-scoped data responses", layer: "API", detail: "active_role from JWT determines what data the API returns. A developer cannot receive org-wide CSO data by accident or by manipulation." },
  { control: "Row-level org isolation", layer: "Database", detail: "Every query includes WHERE org_id = :current_org. Org isolation bug → empty result, never another org's data. Fail closed." },
  { control: "Secrets in environment variables", layer: "Config", detail: "All secrets in env vars. Never logged, never in code. .env in .gitignore. Production via Render environment config." },
  { control: "API rate limiting", layer: "Delivery", detail: "100 REST req/min per JWT identity. 10 webhook events/min per repo. Exceeded → 429 with retry-after." },
  { control: "Input validation at boundary", layer: "Processing", detail: "All webhook payloads validated against expected schema. Unexpected fields stripped. Malformed payloads rejected before queue." },
];

const apiEndpoints = [
  { method: "GET", path: "/auth/github", auth: "None", desc: "Initiate GitHub OAuth flow.", response: "302 Redirect" },
  { method: "GET", path: "/auth/callback", auth: "None", desc: "Handle OAuth callback. Check primary_role. If null → redirect onboarding. Issue JWT with org_id + active_role.", response: "302 → Onboarding or Dashboard" },
  { method: "POST", path: "/auth/onboarding", auth: "Temp token", desc: "Set primary_role on first login. Issues full JWT. Never called again after first login.", response: "200 + JWT" },
  { method: "POST", path: "/auth/switch-role", auth: "JWT", desc: "Update active_role in session. Issues new JWT with updated role. Old token invalidated.", response: "200 + new JWT" },
  { method: "POST", path: "/webhook/github", auth: "HMAC signature", desc: "Receive GitHub push/PR events. Validate, dedup, enqueue. Returns immediately.", response: "202 Accepted" },
  { method: "GET", path: "/api/dashboard/:role", auth: "JWT → org_id + active_role", desc: "Returns role-appropriate dashboard data. developer → personal scores. senior → PR queue. qa → risk manifest. devops → pipeline status. cso → org aggregates.", response: "200 role-scoped data" },
  { method: "GET", path: "/api/repos", auth: "JWT → org_id", desc: "List repos connected to org. Paginated with opaque cursor.", response: "200 + cursor" },
  { method: "GET", path: "/api/commits/:sha/results", auth: "JWT → org_id", desc: "Full analysis result for one commit. All files, all issues, AI engine used, degraded flag.", response: "200 full result" },
  { method: "GET", path: "/api/dashboard/org", auth: "JWT → org_id · CSO only", desc: "Org-wide scores, trends, top issues, most improved developer. CSO view only.", response: "200 aggregates" },
  { method: "WS", path: "/ws/live", auth: "JWT on handshake → org_id + active_role", desc: "Real-time job events. Org-scoped. Role-filtered. Reconnectable with backoff.", response: "Stream of events" },
  { method: "GET", path: "/api/health", auth: "None", desc: "Queue depth, worker count, AI fallback rate, end-to-end p95 latency.", response: "200 metrics" },
];

const methodColor = { GET: "#059669", POST: "#2563eb", WS: "#7c3aed" };

export default function ArchitectureV4() {
  const [activeTab, setActiveTab] = useState("Request Flow");
  const [selectedComp, setSelectedComp] = useState("oauth");
  const [activeStep, setActiveStep] = useState(null);
  const [activeRole, setActiveRole] = useState("developer");

  const allComps = layers.flatMap(l => l.components);
  const comp = allComps.find(c => c.id === selectedComp);

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#f8f8f7", minHeight: "100vh", padding: "24px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>Staff-Level Architecture · v4</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#111", margin: "0 0 4px", letterSpacing: "-0.03em" }}>DevLens — System Architecture</h1>
          <p style={{ fontSize: 13, color: "#888", margin: 0 }}>5 roles · Role switching · Request flow · Failure-aware · Observable · Secure</p>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: "7px 16px", borderRadius: 8, border: activeTab === t ? "none" : "1px solid #e8e8e6",
              cursor: "pointer", fontSize: 13, fontWeight: 500,
              background: activeTab === t ? "#111" : "#fff",
              color: activeTab === t ? "#fff" : "#888",
              transition: "all 0.15s"
            }}>{t}</button>
          ))}
        </div>

        {/* REQUEST FLOW */}
        {activeTab === "Request Flow" && (
          <div>
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#1e40af", marginBottom: 16 }}>
              Click any step to expand. Total time from git push to visible result on the correct role view: under 30 seconds.
            </div>
            <div style={{ background: "#fff", border: "1px solid #ebebea", borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>End-to-end latency budget — 30 seconds total</div>
              <div style={{ display: "flex", gap: 2, height: 28, borderRadius: 6, overflow: "hidden" }}>
                {[
                  { label: "GitHub", width: 4, color: "#d1d5db" },
                  { label: "Validate", width: 4, color: "#818cf8" },
                  { label: "Queue", width: 2, color: "#f87171" },
                  { label: "AI Analysis (~80% of budget)", width: 76, color: "#a78bfa" },
                  { label: "DB", width: 7, color: "#60a5fa" },
                  { label: "WS", width: 4, color: "#34d399" },
                  { label: "UI", width: 3, color: "#22d3ee" },
                ].map((s, i) => (
                  <div key={i} style={{ width: `${s.width}%`, background: s.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap" }}>
                    {s.width >= 8 ? s.label : ""}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#aaa" }}>
                <span>0s</span><span>30s</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {requestFlowSteps.map((s, i) => (
                <div key={s.step} style={{ display: "flex", gap: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 48, flexShrink: 0 }}>
                    <div onClick={() => setActiveStep(activeStep === s.step ? null : s.step)} style={{ width: 32, height: 32, borderRadius: "50%", background: activeStep === s.step ? s.color : "#fff", border: `2px solid ${s.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: activeStep === s.step ? "#fff" : s.color, cursor: "pointer", transition: "all 0.2s", flexShrink: 0, zIndex: 1 }}>{s.step}</div>
                    {i < requestFlowSteps.length - 1 && <div style={{ width: 2, flex: 1, background: "#e8e8e6", minHeight: 20 }} />}
                  </div>
                  <div style={{ flex: 1, padding: "4px 0 20px 16px", cursor: "pointer" }} onClick={() => setActiveStep(activeStep === s.step ? null : s.step)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: s.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.actor}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#111", fontFamily: "'DM Mono', monospace" }}>{s.action}</span>
                      <span style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>{s.timing}</span>
                    </div>
                    {activeStep === s.step && (
                      <div style={{ background: "#f8f8f7", borderLeft: `3px solid ${s.color}`, borderRadius: "0 8px 8px 0", padding: "12px 14px", fontSize: 13, color: "#444", lineHeight: 1.75, marginTop: 8 }}>{s.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "16px 20px", marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9l4 4 8-8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#166534" }}>Results appear on the correct role view — under 30 seconds after git push</div>
                <div style={{ fontSize: 12, color: "#4ade80", marginTop: 2 }}>Developer sees scores. Senior dev sees PR queue. QA sees risk manifest. No refresh. No action required.</div>
              </div>
            </div>
          </div>
        )}

        {/* ARCHITECTURE */}
        {activeTab === "Architecture" && (
          <>
            <div style={{ background: "#fff", border: "1px solid #ebebea", borderRadius: 16, padding: "24px 20px", marginBottom: 16 }}>
              {layers.map((layer, li) => (
                <div key={layer.label} style={{ marginBottom: li < layers.length - 1 ? 16 : 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#ccc", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{layer.label}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {layer.components.map(c => {
                      const isSelected = selectedComp === c.id;
                      return (
                        <div key={c.id} onClick={() => setSelectedComp(c.id)} style={{ flex: 1, minWidth: 160, padding: "12px 16px", borderRadius: 10, cursor: "pointer", background: isSelected ? c.color : "#f8f8f7", border: isSelected ? `2px solid ${c.color}` : "1.5px solid #e8e8e6", transform: isSelected ? "translateY(-2px)" : "none", transition: "all 0.18s" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? c.textColor : "#111", marginBottom: 3 }}>{c.label}</div>
                          <div style={{ fontSize: 11, color: isSelected ? "rgba(255,255,255,0.7)" : "#aaa" }}>{c.sublabel}</div>
                        </div>
                      );
                    })}
                  </div>
                  {li < layers.length - 1 && (
                    <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 4px" }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M4 10l4 4 4-4" stroke="#ddd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {comp && (
              <div style={{ background: "#fff", border: `2px solid ${comp.color}`, borderRadius: 16, padding: "24px 28px" }}>
                <div style={{ display: "inline-block", background: comp.color, color: comp.textColor, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, marginBottom: 10 }}>{comp.sublabel}</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111", margin: "0 0 20px", letterSpacing: "-0.02em" }}>{comp.label}</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {[
                    { label: "What it does", color: "#6366f1", text: comp.what },
                    { label: "Why it exists", color: "#059669", text: comp.why },
                    { label: "Tradeoff", color: "#d97706", text: comp.tradeoff },
                    { label: "Failure behaviour", color: "#dc2626", text: comp.failure },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#f8f8f7", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: s.color, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>{s.label}</div>
                      <div style={{ fontSize: 13, color: "#444", lineHeight: 1.75 }}>{s.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ROLE MODEL */}
        {activeTab === "Role Model" && (
          <div>
            <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#5b21b6", marginBottom: 16 }}>
              One app. Five views. Role picked once on first login. Switchable anytime from the top nav. Session remembers last used role.
            </div>
            <div style={{ background: "#fff", border: "1px solid #ebebea", borderRadius: 12, padding: "20px 24px", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 16 }}>Onboarding flow — first login only</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {["GitHub OAuth", "Check primary_role in DB", "null → Onboarding screen", "Pick role", "JWT issued", "Dashboard"].map((s, i, arr) => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ padding: "6px 12px", borderRadius: 8, background: i === 2 ? "#fef2f2" : i === 5 ? "#f0fdf4" : "#f8f8f7", border: `1px solid ${i === 2 ? "#fca5a5" : i === 5 ? "#bbf7d0" : "#e8e8e6"}`, fontSize: 12, fontWeight: 500, color: i === 2 ? "#dc2626" : i === 5 ? "#059669" : "#444", whiteSpace: "nowrap" }}>{s}</div>
                    {i < arr.length - 1 && <span style={{ color: "#ddd", fontSize: 16 }}>→</span>}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>Click a role to see their dashboard view</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {roles.map(r => (
                <button key={r.id} onClick={() => setActiveRole(r.id)} style={{ padding: "7px 16px", borderRadius: 99, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: activeRole === r.id ? r.color : "#fff", color: activeRole === r.id ? "#fff" : "#666", border: activeRole === r.id ? "none" : "1px solid #e8e8e6", transition: "all 0.15s" }}>{r.label}</button>
              ))}
            </div>
            {roles.filter(r => r.id === activeRole).map(r => (
              <div key={r.id} style={{ background: "#fff", border: `2px solid ${r.color}`, borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ display: "inline-block", background: r.color, color: "#fff", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, marginBottom: 10 }}>Default dashboard view</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 8 }}>{r.label}</div>
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.75 }}>{r.view}</div>
                <div style={{ marginTop: 14, padding: "10px 14px", background: "#f8f8f7", borderRadius: 8, fontSize: 12, color: "#888" }}>
                  Can switch to any other role view from the top nav dropdown at any time during the session.
                </div>
              </div>
            ))}
            <div style={{ marginTop: 16, background: "#fff", border: "1px solid #ebebea", borderRadius: 12, padding: "20px 24px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 12 }}>What lives in the JWT</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, background: "#1e1b4b", color: "#c7d2fe", padding: "16px", borderRadius: 8, lineHeight: 1.8 }}>
                {`{
  "user_id": "usr_abc123",
  "org_id":  "org_xyz456",
  "github_id": 12345678,
  "primary_role": "senior",
  "active_role":  "developer",
  "exp": 1705312800
}`}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "#888", lineHeight: 1.7 }}>
                <strong style={{ color: "#555" }}>primary_role</strong> — set once at onboarding, never changes unless user explicitly updates it.<br />
                <strong style={{ color: "#555" }}>active_role</strong> — updated on every role switch. Resets to primary_role on new login session.
              </div>
            </div>
          </div>
        )}

        {/* FAILURE MODES */}
        {activeTab === "Failure Modes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#991b1b" }}>Every failure mode has a defined response. No silent failures. No undefined behaviour.</div>
            {failureModes.map((f, i) => (
              <div key={i} style={{ background: "#fff", borderLeft: `3px solid ${f.impact === "High" ? "#dc2626" : f.impact === "Medium" ? "#d97706" : "#059669"}`, border: "1px solid #ebebea", borderRadius: 10, padding: "16px 20px" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{f.scenario}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 500, background: f.impact === "High" ? "#fef2f2" : f.impact === "Medium" ? "#fffbeb" : "#f0fdf4", color: f.impact === "High" ? "#dc2626" : f.impact === "Medium" ? "#d97706" : "#059669" }}>{f.impact}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 500, background: f.idempotent ? "#f0fdf4" : "#fef2f2", color: f.idempotent ? "#059669" : "#dc2626" }}>{f.idempotent ? "Idempotent" : "Manual recovery"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Response</div><div style={{ fontSize: 12, color: "#555", lineHeight: 1.7 }}>{f.response}</div></div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Prevention</div><div style={{ fontSize: 12, color: "#555", lineHeight: 1.7 }}>{f.prevention}</div></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* OBSERVABILITY */}
        {activeTab === "Observability" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10 }}>
              {[
                { metric: "End-to-end latency", target: "p95 < 30s", alert: "p95 > 28s → alert", color: "#059669", note: "Push → visible on dashboard. The metric product cares about." },
                { metric: "Queue depth", target: "< 20 jobs", alert: "> 20 → alert", color: "#6366f1", note: "Leading indicator — rises before latency does." },
                { metric: "Job processing time", target: "p50 < 15s, p95 < 28s", alert: "p95 > 28s → alert", color: "#d97706", note: "AI analysis only, excluding queue wait." },
                { metric: "AI fallback rate", target: "< 5%", alert: "> 5% → alert", color: "#b45309", note: "% of jobs hitting local model." },
                { metric: "DLQ job count", target: "0", alert: "Any job → alert", color: "#dc2626", note: "Any number above zero needs investigation." },
              ].map(m => (
                <div key={m.metric} style={{ background: "#fff", border: "1px solid #ebebea", borderTop: `3px solid ${m.color}`, borderRadius: 10, padding: "14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111", marginBottom: 6 }}>{m.metric}</div>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>Target: {m.target}</div>
                  <div style={{ fontSize: 11, color: "#dc2626", background: "#fef2f2", padding: "3px 8px", borderRadius: 6, marginBottom: 8 }}>{m.alert}</div>
                  <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5, fontStyle: "italic" }}>{m.note}</div>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", border: "1px solid #ebebea", borderRadius: 12, padding: "20px 24px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 12 }}>Structured log — every job state transition</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, background: "#1e1b4b", color: "#c7d2fe", padding: "16px", borderRadius: 8, lineHeight: 1.8 }}>
{`{
  "timestamp":       "2024-01-15T10:23:45Z",
  "event":           "job.completed",
  "job_id":          "job_abc123",
  "commit_sha":      "a1b2c3d4",
  "org_id":          "org_xyz",
  "repo":            "acme/backend",
  "files_analysed":  6,
  "queue_wait_ms":   1200,
  "analysis_ms":     11800,
  "db_write_ms":     340,
  "ws_broadcast_ms": 90,
  "end_to_end_ms":   13430,
  "ai_engine":       "huggingface",
  "degraded":        false
}`}
              </div>
            </div>
          </div>
        )}

        {/* SECURITY */}
        {activeTab === "Security" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#92400e" }}>A tool that finds security issues in other people's code must itself be a security exemplar.</div>
            {securityControls.map((s, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #ebebea", borderRadius: 10, padding: "16px 20px", display: "flex", gap: 16 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#b45309", flexShrink: 0, marginTop: 5 }} />
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{s.control}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "#fef3c7", color: "#92400e", fontWeight: 500 }}>{s.layer}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#555", lineHeight: 1.7 }}>{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* API CONTRACT */}
        {activeTab === "API Contract" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#166534" }}>JWT middleware extracts org_id and active_role before every handler. All data org-scoped. Role-filtered at API layer — not frontend.</div>
            {apiEndpoints.map((e, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #ebebea", borderRadius: 10, padding: "14px 18px", display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 280, flex: 1 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: `${methodColor[e.method]}20`, color: methodColor[e.method], minWidth: 42, textAlign: "center" }}>{e.method}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#333" }}>{e.path}</span>
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <div style={{ fontSize: 13, color: "#444", marginBottom: 4 }}>{e.desc}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#888" }}>{e.auth}</span>
                    <span style={{ fontSize: 11, color: "#6366f1", fontFamily: "'DM Mono', monospace" }}>{e.response}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}