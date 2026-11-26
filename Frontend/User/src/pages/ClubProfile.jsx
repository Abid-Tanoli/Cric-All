import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../services/api";
import { setMetaAttribute } from "../hooks/usePageMeta";
import SafeImage from "../../../Shared/components/SafeImage.jsx";
import NotFound from "./NotFound";
import { locationLine } from "../../../Shared/utils/locationDisplay.js";
import {
  orgTypeIcon,
  orgTypeLabel,
  teamRoleLabel,
  verificationBadge,
} from "../../../Shared/orgTypes.js";
import {
  EMPTY_PERFORMERS,
  PerformerCard,
  TeamMatchRow,
  formatDecimal,
} from "../components/TeamOverviewCards";

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-cric-card p-5 shadow-sm">
      <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-cric-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

const SOCIAL_LABELS = {
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

export default function ClubProfile() {
  const { slug } = useParams();
  const [club, setClub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchClub = async () => {
      setLoading(true);
      setMissing(false);
      try {
        const res = await api.get(`/organizations/public/${encodeURIComponent(slug)}`);
        if (!cancelled) setClub(res.data?.data || res.data);
      } catch (error) {
        if (!cancelled) {
          const notFound =
            error?.response?.status === 404 || error?.response?.status === 400;
          setClub(null);
          setMissing(notFound);
          if (!notFound) console.error(error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchClub();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, attempt]);

  useEffect(() => {
    if (!club?.organization?.name) return;
    const org = club.organization;
    document.title = `${org.name} | CricAll`;
    // Without this the canonical link still points at the previously visited
    // page, and search engines treat the club page as a duplicate of it.
    setMetaAttribute(
      'link[rel="canonical"]',
      "href",
      { tag: "link", attribute: "rel", value: "canonical" },
      `${window.location.origin}/club/${org.slug || slug}`,
    );
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute(
        "content",
        org.description
          ? org.description.slice(0, 160)
          : `Fixtures, results and top performers for ${org.name}, a cricket club on CricAll.`,
      );
    }
  }, [club, slug]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cric-bg">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-cric-accent border-t-transparent" />
          <p className="text-xs font-black uppercase tracking-widest text-cric-muted">
            Loading club...
          </p>
        </div>
      </div>
    );
  }

  if (missing) return <NotFound />;

  // A network or server failure is not "this club does not exist".
  if (!club?.organization) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cric-bg px-4">
        <div role="alert" className="text-center">
          <p className="text-sm font-semibold text-cric-text">Could not load this club.</p>
          <button
            type="button"
            onClick={() => setAttempt((current) => current + 1)}
            className="mt-4 rounded-full bg-cric-accent px-5 py-2 text-xs font-black uppercase tracking-wider text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const org = club.organization;
  const teams = club.teams || [];
  const liveMatches = club.liveMatches || [];
  const upcomingMatches = club.upcomingMatches || [];
  const recentResults = club.recentResults || [];
  const topPerformers = club.topPerformers || EMPTY_PERFORMERS;
  const socialLinks = Object.entries(org.socialLinks || {}).filter(([, url]) => url);
  const location = locationLine(
    org.locationLabels,
    [org.location?.area || org.location?.city, org.location?.country]
      .filter(Boolean)
      .join(", "),
  );

  return (
    <div className="min-h-screen bg-cric-bg font-sans text-cric-text">
      {/* Cover + identity. Mobile first: a shorter cover and a stacked header. */}
      <header className="relative">
        <div className="h-36 w-full overflow-hidden bg-gradient-to-br from-[#031d44] to-[#003087] sm:h-48 md:h-60">
          {org.coverUrl ? (
            <SafeImage
              src={org.coverUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="mx-auto max-w-5xl px-4">
          <div className="-mt-10 flex flex-col gap-4 sm:-mt-12 sm:flex-row sm:items-end">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-cric-bg bg-white text-3xl font-black text-cric-accent shadow-lg sm:h-24 sm:w-24">
              {org.logoUrl ? (
                <SafeImage src={org.logoUrl} alt={org.name} className="h-full w-full object-cover" />
              ) : (
                (org.name || "?").charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black uppercase tracking-tight sm:text-4xl">
                  {org.name}
                </h1>
                {org.verificationStatus === "verified" ? (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${verificationBadge("verified").className}`}
                  >
                    ✓ Verified
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-cric-muted">
                <span className="rounded-full border border-cric-border bg-cric-card px-3 py-1 font-black uppercase tracking-wider">
                  {orgTypeIcon(org)} {orgTypeLabel(org)}
                </span>
                {location ? <span>📍 {location}</span> : null}
                {org.foundedYear ? <span>Est. {org.foundedYear}</span> : null}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <Section title="About">
          {org.description ? (
            <p className="whitespace-pre-line text-sm text-cric-text">{org.description}</p>
          ) : (
            <p className="text-sm font-semibold text-cric-muted">
              This club has not added a description yet.
            </p>
          )}
          {org.website ? (
            <a
              href={org.website}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-bold text-cric-accent hover:underline"
            >
              {org.website}
            </a>
          ) : null}
          {socialLinks.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {socialLinks.map(([key, url]) => (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-cric-border bg-cric-bg px-3 py-1 text-xs font-bold text-cric-text transition-all hover:border-cric-accent"
                >
                  {SOCIAL_LABELS[key] || key}
                </a>
              ))}
            </div>
          ) : null}
        </Section>

        <Section title={`Teams${teams.length ? ` (${teams.length})` : ""}`}>
          {teams.length === 0 ? (
            <p className="text-sm font-semibold text-cric-muted">
              This club has not published a team yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((team) => (
                <Link
                  key={team._id}
                  to={`/teams/${team._id}`}
                  className="flex items-center gap-3 rounded-xl border border-cric-border bg-cric-bg px-4 py-3 transition-all hover:border-cric-accent"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cric-accent font-black text-white">
                    {team.logo ? (
                      <SafeImage src={team.logo} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (team.shortName || team.name || "?").charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-cric-text">{team.name}</p>
                    <p className="text-xs text-cric-muted">
                      {teamRoleLabel(team.teamRole)}
                      {team.branchName ? ` • ${team.branchName}` : ""}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {liveMatches.length ? (
          <Section title="Live now">
            <div className="space-y-3">
              {liveMatches.map((match) => (
                <TeamMatchRow key={match._id} match={match} club live />
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Upcoming matches">
          {upcomingMatches.length === 0 ? (
            <p className="text-sm font-semibold text-cric-muted">No upcoming matches yet.</p>
          ) : (
            <div className="space-y-3">
              {upcomingMatches.map((match) => (
                <TeamMatchRow key={match._id} match={match} club />
              ))}
            </div>
          )}
        </Section>

        <Section title="Recent results">
          {recentResults.length === 0 ? (
            <p className="text-sm font-semibold text-cric-muted">
              No completed matches yet.
            </p>
          ) : (
            <div className="space-y-3">
              {recentResults.map((match) => (
                <TeamMatchRow key={match._id} match={match} club result />
              ))}
            </div>
          )}
        </Section>

        <Section title="Top performers">
          {!topPerformers.topRunScorer &&
          !topPerformers.topWicketTaker &&
          !topPerformers.bestStrikeRate ? (
            <p className="text-sm font-semibold text-cric-muted">
              No individual performances recorded yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <PerformerCard
                label="Top run scorer"
                performer={topPerformers.topRunScorer}
                detail={(player) => `${player.runs} runs in ${player.matches} matches`}
              />
              <PerformerCard
                label="Top wicket taker"
                performer={topPerformers.topWicketTaker}
                detail={(player) => `${player.wickets} wickets in ${player.matches} matches`}
              />
              <PerformerCard
                label="Best strike rate"
                performer={topPerformers.bestStrikeRate}
                detail={(player) =>
                  `${formatDecimal(player.strikeRate)} SR over ${player.matches} matches`
                }
              />
            </div>
          )}
        </Section>
      </main>
    </div>
  );
}
