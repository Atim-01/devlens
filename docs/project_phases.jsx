import { useState } from "react";

const phases = [
  {
    id: 1,
    name: "The Foundation",
    tagline: "A working code reviewer you can actually use",
    color: "#6366f1",
    duration: "2–3 weeks",
    status: "Build this first",
    what: "A developer pushes code to GitHub. DevLens receives the webhook, analyses the changed files using HuggingFace, scores them across 5 dimensions, and shows the results on a clean dashboard. One role — developer. One flow — push to result.",
    why: "This is the core value of DevLens proven end to end. Every other phase builds on top of this. If this works, the product works.",
    standAlone: "A solo developer can connect their GitHub repo, push code, and immediately see AI-powered scores and issues with explanations on their personal dashboard. That is a complete, useful product on its own.",
    backend: [
      "FastAPI project setup with uv",
      "PostgreSQL + SQLAlchemy + Alembic — organisations, users, repos, commits, jobs, scores, issues tables",
      "All indexes from the schema",
      "GitHub OAuth — login, JWT issued, onboarding screen",
      "POST /webhook/github — validate, dedup, enqueue",
      "Redis + RQ job queue — 3 retries, exponential backoff, DLQ",
      "HuggingFace AI service — CodeBERT analysis across 5 dimensions",
      "Local model fallback — circuit breaker, degraded flag",
      "Worker — fetch files, analyse, save scores + issues with explanations",
      "GET /api/dashboard/developer — personal scores, issues, growth",
      "GET /api/commits/:sha/results — full commit result",
      "WS /ws/live — full payload broadcast, direct cache update",
      "GET /api/health — queue depth, fallback rate, e2e latency",
    ],
    frontend: [
      "React + Vite setup",
      "GitHub OAuth login flow",
      "Onboarding screen — pick primary role",
      "Developer dashboard — ScoreGrid, IssueList, GrowthChart",
      "IssueExplanation — expandable why + suggested fix",
      "LiveIndicator — WebSocket connected, analysis running",
      "CommitDetail page — full result per commit",
      "DegradedWarning banner — local fallback indicator",
      "useWebSocket hook — direct React Query cache update",
      "useAuth, useDashboard, useCommit hooks",
    ],
    demo: "Connect a real GitHub repo, push actual code with intentional issues, show the dashboard lighting up in real time with scores and explanations.",
  },
  {
    id: 2,
    name: "The Team Layer",
    tagline: "DevLens becomes useful for the whole engineering team",
    color: "#d97706",
    duration: "2 weeks",
    status: "Build second",
    what: "Add the Senior Dev view and QA view. Add role switching. The senior dev sees a PR queue with pre-screened scores. QA sees a risk manifest per build. The developer view gains a streak badge and team context.",
    why: "Phase 1 serves one person. Phase 2 makes DevLens genuinely useful for a team — the people who will actually advocate for adopting it.",
    standAlone: "A small engineering team can use DevLens end to end — developers push code, senior devs review pre-screened PRs, QA gets a risk manifest. Three roles, one product, real team workflow.",
    backend: [
      "POST /auth/switch-role — new JWT with updated active_role",
      "GET /api/dashboard/senior — PR queue, team scores, review efficiency",
      "GET /api/dashboard/qa — risk manifest, high-risk files ranked",
      "GET /api/repos — list connected repos with latest scores",
      "Team scores aggregation query — all members latest scores",
      "PR data pulled from GitHub API and enriched with DevLens scores",
    ],
    frontend: [
      "Role switcher in TopNav — dropdown, instant view change",
      "SeniorDevView — PRQueueCard, TeamScoreGrid, TopIssuesCard",
      "QAView — RiskManifest, RiskChart, TestFocusCard, BuildSummaryCard",
      "useRoleSwitch hook — POST switch-role, update AuthContext",
      "StreakBadge on developer view",
      "Sidebar updates per active_role",
    ],
    demo: "Show a senior dev opening a PR and seeing DevLens scores already there. Switch to QA view and show the risk manifest for the same build. Switch back to developer view — same session, no logout.",
  },
  {
    id: 3,
    name: "The Safety Net",
    tagline: "DevLens stops bad code before it reaches production",
    color: "#dc2626",
    duration: "1–2 weeks",
    status: "Build third",
    what: "Add the DevOps view and the CI pipeline gate. The gate blocks merges when security scores fall below the configured threshold. DevOps gets a dashboard showing gate status per repo, security score trends, and blocked commits.",
    why: "This is the phase that makes DevLens non-optional. Once the gate is live, the team cannot ignore it. It also makes the security-first promise of DevLens tangible.",
    standAlone: "DevOps can configure score thresholds per repo, see which repos are drifting below threshold, and know that no critical security issue can reach production without being flagged first.",
    backend: [
      "GET /api/dashboard/devops — gate status, security trends, blocked commits",
      "PUT /api/repos/:id/threshold — update security_threshold per repo",
      "GET /api/repos/:id/gate-status — current score vs threshold, pass or block",
      "CI gate endpoint — returns pass/fail for a given commit SHA",
      "Blocked commits tracking — save gate decision to jobs table",
    ],
    frontend: [
      "DevOpsView — GateStatusCard, SecurityTrendChart, AlertConfigCard, BlockedCommitsList",
      "Threshold config UI — slider per repo, saved to backend",
      "Gate status badge — green pass, red block, links to issues",
    ],
    demo: "Push code with a deliberate security issue below threshold. Show the CI gate blocking the merge. Fix the issue, push again, gate passes. DevOps dashboard shows the blocked commit and the recovery.",
  },
  {
    id: 4,
    name: "The Command Centre",
    tagline: "Leadership gets visibility across the entire organisation",
    color: "#7c3aed",
    duration: "1–2 weeks",
    status: "Build fourth",
    what: "Add the CSO view with org-wide trends, most improved developer, repos at risk, and the weekly digest email. Add the weekly_aggregates background job that pre-computes org stats every Sunday night.",
    why: "This phase completes the five-role promise of DevLens and adds the strategic layer that makes leadership care about code quality trends rather than just individual issues.",
    standAlone: "An engineering lead can open DevLens on Monday morning and immediately see whether the team's code quality improved or declined last week, which repos need attention, and who deserves recognition — all without asking anyone.",
    backend: [
      "GET /api/dashboard/cso — org aggregates, team trends, most improved",
      "GET /api/dashboard/org — full org-wide view",
      "weekly_aggregates background job — runs Sunday night, pre-computes one row per org",
      "Most improved developer calculation — score delta across the week",
      "Weekly digest email — plain text summary sent automatically",
      "Repos at risk query — repos below threshold in the last 7 days",
    ],
    frontend: [
      "CSOView — OrgScoreCard, TeamTrendChart, MostImprovedCard, ReposAtRiskCard, WeeklyDigestPreview",
      "OrgDashboard page — full org view for CSO",
      "Recharts area chart — weekly org score trend",
      "Most improved callout card with score delta",
    ],
    demo: "Open the CSO view showing a month of trend data. Show a repo that has been improving and one that is drifting. Show the weekly digest preview and the most improved developer callout.",
  },
  {
    id: 5,
    name: "Production Ready",
    tagline: "DevLens is ready for real teams to depend on",
    color: "#059669",
    duration: "1 week",
    status: "Build last",
    what: "Deployment, observability, polished error states, loading skeletons, empty states, and the final performance tuning. Both frontend and backend deployed on free cloud tiers. The health endpoint wired to the dashboard.",
    why: "A product that only works locally is not a product. This phase is about confidence — yours and your users'.",
    standAlone: "DevLens is live at a real URL, connected to real GitHub repos, serving real teams, with observable metrics and a health dashboard. A complete, deployable, demonstrable product.",
    backend: [
      "Deploy FastAPI backend to Render free tier",
      "Deploy PostgreSQL to Render free tier",
      "Deploy Redis to Render free tier",
      "Configure Cloudflare Tunnel for webhook ingress",
      "Structured logging to stdout — all job state transitions",
      "Health endpoint wired — queue depth, fallback rate, e2e latency",
      "Environment config for production vs development",
      "Rate limiting verified in production",
    ],
    frontend: [
      "Deploy React frontend to Vercel free tier",
      "Loading skeletons for all dashboard views",
      "Empty states — first time user, no pushes yet",
      "Error boundaries — graceful degradation on API failure",
      "Stale data warning when API unreachable",
      "Health metrics panel in DevOps view",
      "Final performance audit — bundle size, lazy loading",
    ],
    demo: "The full demo — five roles, live GitHub webhook, real-time analysis, CI gate, org dashboard, deployed at a real URL. The complete DevLens story told in one session.",
  },
];

export default function DevLensPhases() {
  const [active, setActive] = useState(1);
  const phase = phases.find(p => p.id === active);

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#f8f8f7", minHeight: "100vh", padding: "24px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>Build plan</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#111", margin: "0 0 4px", letterSpacing: "-0.03em" }}>DevLens — Five phases, five shippable products</h1>
          <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Each phase is a complete, useable app. Never half-built, always demonstrable.</p>
        </div>

        {/* Phase selector */}
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {phases.map(p => (
            <div key={p.id} onClick={() => setActive(p.id)} style={{ flex: 1, minWidth: 140, padding: "14px 16px", borderRadius: 12, cursor: "pointer", background: active === p.id ? p.color : "#fff", border: active === p.id ? `2px solid ${p.color}` : "1.5px solid #e8e8e6", transition: "all 0.18s", transform: active === p.id ? "translateY(-2px)" : "none" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: active === p.id ? "rgba(255,255,255,0.7)" : "#aaa", marginBottom: 4 }}>Phase {p.id} · {p.duration}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: active === p.id ? "#fff" : "#111", lineHeight: 1.4 }}>{p.name}</div>
            </div>
          ))}
        </div>

        {/* Phase detail */}
        <div style={{ background: "#fff", border: `2px solid ${phase.color}`, borderRadius: 16, overflow: "hidden" }}>

          {/* Header */}
          <div style={{ background: phase.color, padding: "20px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.2)", color: "#fff", padding: "3px 10px", borderRadius: 99 }}>Phase {phase.id}</span>
              <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.2)", color: "#fff", padding: "3px 10px", borderRadius: 99 }}>{phase.duration}</span>
              <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.2)", color: "#fff", padding: "3px 10px", borderRadius: 99 }}>{phase.status}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>{phase.name}</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>{phase.tagline}</div>
          </div>

          <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20 }}>

            {/* What + Why + Standalone */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                { label: "What gets built", color: "#6366f1", text: phase.what },
                { label: "Why this order", color: "#059669", text: phase.why },
                { label: "Standalone value", color: phase.color, text: phase.standAlone },
              ].map(s => (
                <div key={s.label} style={{ background: "#f8f8f7", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>{s.label}</div>
                  <div style={{ fontSize: 13, color: "#444", lineHeight: 1.75 }}>{s.text}</div>
                </div>
              ))}
            </div>

            {/* Build list */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                { label: "Backend", color: "#6366f1", items: phase.backend },
                { label: "Frontend", color: "#0891b2", items: phase.frontend },
              ].map(side => (
                <div key={side.label}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: side.color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{side.label}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {side.items.map((item, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: side.color, flexShrink: 0, marginTop: 6 }} />
                        <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>{item}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Demo moment */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Demo moment — what you show at the end of this phase</div>
              <div style={{ fontSize: 13, color: "#166534", lineHeight: 1.75 }}>{phase.demo}</div>
            </div>

            {/* Phase navigation */}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4 }}>
              <button onClick={() => setActive(Math.max(1, active - 1))} disabled={active === 1} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #e8e8e6", background: "#fff", color: active === 1 ? "#ccc" : "#444", cursor: active === 1 ? "default" : "pointer", fontSize: 13, fontWeight: 500 }}>← Previous phase</button>
              <button onClick={() => setActive(Math.min(5, active + 1))} disabled={active === 5} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: active === 5 ? "#e8e8e6" : phase.color, color: active === 5 ? "#aaa" : "#fff", cursor: active === 5 ? "default" : "pointer", fontSize: 13, fontWeight: 500 }}>Next phase →</button>
            </div>

          </div>
        </div>

        {/* Timeline summary */}
        <div style={{ marginTop: 20, background: "#fff", border: "1px solid #ebebea", borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>Total timeline estimate</div>
          <div style={{ display: "flex", gap: 0, height: 32, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
            {[
              { label: "Phase 1", width: 35, color: "#6366f1" },
              { label: "Phase 2", width: 25, color: "#d97706" },
              { label: "Phase 3", width: 15, color: "#dc2626" },
              { label: "Phase 4", width: 15, color: "#7c3aed" },
              { label: "Phase 5", width: 10, color: "#059669" },
            ].map((s, i) => (
              <div key={i} style={{ width: `${s.width}%`, background: s.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 600 }}>{s.label}</div>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
            Estimated total: <strong style={{ color: "#111" }}>7–10 weeks</strong> of focused building. Phase 1 is the longest because it establishes every foundational pattern the other phases inherit. Phases 3, 4, and 5 are fast because the hard infrastructure work is already done.
          </div>
        </div>

      </div>
    </div>
  );
}