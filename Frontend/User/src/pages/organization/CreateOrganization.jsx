import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  createOrganization,
  createOrgTeam,
  listMyOrganizations,
  requestOrganizationVerification,
} from "../../services/organizationApi";
import { getStoredUser, notifyMembershipChanged } from "../auth/auth";
import LocationSelect from "../../../../Shared/components/LocationSelect.jsx";
import RegistrationBranch from "../../components/RegistrationBranch";
import {
  emptyTypeDetails,
  legacyTypeForOrgType,
  ORG_TYPE_VALUES,
  serializeTypeDetails,
  teamRoleLabel,
} from "../../../../Shared/orgTypes.js";
import { OrgTypeDetails, OrgTypePicker } from "./OrgTypeFields";
import { Banner, Field, card, eyebrow, input, primaryButton, secondaryButton } from "./orgStyles";

const emptyForm = {
  name: "",
  shortName: "",
  type: "other",
  orgType: "local_club",
  typeDetails: emptyTypeDetails("local_club"),
  requestVerification: false,
  createDefaultTeam: true,
  description: "",
  website: "",
  location: { city: "", area: "", address: "", country: "" },
  locationRefs: { countryId: null, provinceId: null, districtId: null, cityId: null, townId: null },
  locationLabels: { country: "", province: "", district: "", city: "", town: "" },
  contact: { phone: "", email: "" },
  socialLinks: [["", ""]],
  privacy: { contactInfo: "public", socialLinks: "public", location: "public" },
};

export default function CreateOrganization() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const storedUser = getStoredUser();
  const requestedType = searchParams.get("orgType");
  const orgTypeFromUrl = ORG_TYPE_VALUES.includes(requestedType) ? requestedType : "";

  const [form, setForm] = useState(() => ({
    ...emptyForm,
    orgType: orgTypeFromUrl || emptyForm.orgType,
    type: legacyTypeForOrgType(orgTypeFromUrl || emptyForm.orgType),
    typeDetails: emptyTypeDetails(orgTypeFromUrl || emptyForm.orgType),
  }));
  const [parents, setParents] = useState([]);
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState("");

  useEffect(() => {
    listMyOrganizations()
      .then((res) => {
        const manageable = (Array.isArray(res) ? res : []).filter(
          (org) => (org.myRoles || []).includes("owner") || (org.myRoles || []).includes("admin")
        );
        setParents(manageable);
      })
      .catch(() => setParents([]));
  }, []);

  const setTop = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const chooseType = (orgType) =>
    setForm((f) => ({
      ...f,
      orgType,
      type: legacyTypeForOrgType(orgType),
      typeDetails: emptyTypeDetails(orgType),
      requestVerification: false,
    }));
  const chooseBranch = (branch) => {
    if (!branch.orgType) {
      navigate("/register?mode=register&branch=player", { replace: true });
      return;
    }
    setSearchParams({ orgType: branch.orgType }, { replace: true });
    chooseType(branch.orgType);
  };
  const setDetail = (key, value) =>
    setForm((f) => ({ ...f, typeDetails: { ...f.typeDetails, [key]: value } }));
  const setNested = (group, key) => (event) =>
    setForm((f) => ({ ...f, [group]: { ...f[group], [key]: event.target.value } }));

  const setSocial = (index, position, value) =>
    setForm((f) => {
      const next = f.socialLinks.map((pair) => [...pair]);
      next[index][position] = value;
      return { ...f, socialLinks: next };
    });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const socialLinks = {};
      for (const [key, value] of form.socialLinks) {
        const cleanKey = key.trim().toLowerCase();
        const cleanValue = value.trim();
        if (cleanKey && cleanValue) socialLinks[cleanKey] = cleanValue;
      }

      const payload = {
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        type: form.type,
        orgType: form.orgType,
        createDefaultTeam: form.createDefaultTeam,
        typeDetails: serializeTypeDetails(form.orgType, form.typeDetails),
        description: form.description.trim(),
        website: form.website.trim(),
        location: {
          city: form.location.city.trim(),
          area: form.location.area.trim(),
          address: form.location.address.trim(),
          country: form.location.country.trim(),
        },
        contact: { phone: form.contact.phone.trim(), email: form.contact.email.trim() },
        socialLinks,
        privacy: { ...form.privacy },
        locationRefs: form.locationRefs,
        locationLabels: form.locationLabels,
      };
      if (parent) payload.parent = parent;

      const res = await createOrganization(payload);
      if (form.requestVerification && payload.typeDetails.registrationNumber) {
        await requestOrganizationVerification(res.organization._id);
      }
      // This account now belongs to an organization. The header caches that
      // fact per signed-in session, so it has to be told before we navigate.
      notifyMembershipChanged();
      setCreated({
        organization: res.organization,
        team: res.defaultTeam || null,
        failure: res.defaultTeamError || "",
        teamName: form.name.trim() || res.organization.name,
      });
    } catch (error) {
      setErr(error.message || "Could not create the organization");
    } finally {
      setBusy(false);
    }
  };

  const retryTeam = async () => {
    if (!created) return;
    setRetryBusy(true);
    setRetryError("");
    try {
      const result = await createOrgTeam(created.organization._id, {
        name: created.teamName,
        teamRole: "1st XI",
      });
      const team = result?.team || result;
      setCreated((current) => ({ ...current, team, failure: "" }));
    } catch (error) {
      setRetryError(error.message || "Could not create the team");
    } finally {
      setRetryBusy(false);
    }
  };

  if (!storedUser) return null;

  if (!orgTypeFromUrl) {
    return (
      <div className="min-h-screen bg-cric-bg px-4 py-8 text-cric-text">
        <div className="mx-auto max-w-3xl">
          <RegistrationBranch onSelect={chooseBranch} />
        </div>
      </div>
    );
  }

  if (created) {
    const orgId = created.organization._id;
    return (
      <div className="min-h-screen bg-cric-bg px-4 py-8 text-cric-text">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className={card}>
            <p className={eyebrow}>Done</p>
            <h1 className="mt-1 text-2xl font-black uppercase tracking-tight">Organization created</h1>
            <p className="mt-2 text-sm font-semibold text-cric-muted">
              <span className="font-black text-cric-text">{created.organization.name}</span> is ready. You are its owner.
            </p>
            {created.team ? (
              <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">
                First team “{created.team.name}” ({teamRoleLabel(created.team.teamRole)}) is ready.
              </p>
            ) : (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-black text-amber-800">
                  {created.failure || "Default team was not created"}
                </p>
                <button
                  type="button"
                  onClick={retryTeam}
                  disabled={retryBusy}
                  className="mt-3 rounded-lg bg-cric-accent px-5 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-60"
                >
                  {retryBusy ? "Creating…" : "Create team now"}
                </button>
                {retryError ? <p className="mt-2 text-xs font-bold text-red-600">{retryError}</p> : null}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate(`/organization?org=${orgId}&tab=players`)}
              className={primaryButton}
            >
              Add players
            </button>
            <button
              type="button"
              onClick={() => navigate(`/organization?org=${orgId}&tab=teams`)}
              className={secondaryButton}
            >
              Add another team
            </button>
            <Link to={`/organization?org=${orgId}`} className={secondaryButton}>
              Go to organization
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cric-bg px-4 py-8 text-cric-text">
      <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4">
        <div className={card}>
          <p className={eyebrow}>Self-service</p>
          <h1 className="mt-1 text-2xl font-black uppercase tracking-tight">Create an organization</h1>
          <p className="mt-2 text-sm font-semibold text-cric-muted">
            No admin approval needed — you become its owner and can invite members and create teams
            straight away.
          </p>

          {err ? <div className="mt-4"><Banner kind="error">{err}</Banner></div> : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Name *">
              <input
                value={form.name}
                onChange={setTop("name")}
                placeholder="e.g. Crescent Public School Cricket Club"
                className={input}
                required
                minLength={2}
                maxLength={150}
              />
            </Field>
            <Field label="Short name">
              <input value={form.shortName} onChange={setTop("shortName")} className={input} maxLength={20} />
            </Field>
          </div>

          <div className="mt-4 rounded-xl border border-cric-border bg-cric-bg p-4">
            <p className="text-xs font-black uppercase tracking-widest text-cric-text">
              A first team will be created automatically
            </p>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              “{form.name.trim() || "Your organization"}” · 1st XI · your account becomes its manager.
            </p>
            <label className="mt-3 flex items-start gap-3 text-xs font-semibold text-cric-text">
              <input
                type="checkbox"
                checked={form.createDefaultTeam}
                onChange={(event) => setForm((f) => ({ ...f, createDefaultTeam: event.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-cric-accent"
              />
              <span>Create the first team automatically (recommended)</span>
            </label>
          </div>

          <div className="mt-5">
            <OrgTypePicker value={form.orgType} onChange={chooseType} />
          </div>

          <div className="mt-4">
            <OrgTypeDetails orgType={form.orgType} value={form.typeDetails} onChange={setDetail} />
          </div>

          {form.orgType === "registered_club" ? (
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-cric-border bg-cric-bg p-3 text-sm font-semibold text-cric-text">
              <input
                type="checkbox"
                checked={form.requestVerification}
                onChange={(event) => setForm((f) => ({ ...f, requestVerification: event.target.checked }))}
                className="mt-1 h-4 w-4 accent-cric-accent"
              />
              <span>
                Request verification after saving
                <span className="mt-1 block text-[11px] font-semibold text-cric-muted">
                  A platform admin reviews the registration number. Nothing is shown publicly except the badge.
                </span>
              </span>
            </label>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Website">
              <input value={form.website} onChange={setTop("website")} className={input} placeholder="https://…" />
            </Field>
            <Field label="Sub-organization of" hint={parents.length === 0 ? "You manage no parent org yet." : undefined}>
              <select value={parent} onChange={(e) => setParent(e.target.value)} className={input}>
                <option value="">— None (top level) —</option>
                {parents.map((org) => (
                  <option key={org._id} value={org._id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4">
            <Field label="About">
              <textarea
                value={form.description}
                onChange={setTop("description")}
                rows={4}
                className={input}
                maxLength={2000}
                placeholder="What this organization does, who it serves, how to reach it."
              />
            </Field>
          </div>
        </div>

        <div className={card}>
          <h2 className="text-sm font-black uppercase tracking-widest text-cric-text">Location &amp; contact</h2>
          <div className="mt-4">
            <LocationSelect
              compact
              value={form.locationRefs}
              labels={form.locationLabels}
              legacyHint={[form.location.city, form.location.country].filter(Boolean).join(", ")}
              onChange={(refs, labels) =>
                setForm((f) => ({ ...f, locationRefs: refs, locationLabels: labels }))
              }
            />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Area / neighbourhood (optional)">
              <input value={form.location.area} onChange={setNested("location", "area")} className={input} />
            </Field>
            <Field label="Contact phone">
              <input value={form.contact.phone} onChange={setNested("contact", "phone")} className={input} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Public contact email">
              <input
                type="email"
                value={form.contact.email}
                onChange={setNested("contact", "email")}
                className={input}
              />
            </Field>
          </div>
        </div>

        <div className={card}>
          <h2 className="text-sm font-black uppercase tracking-widest text-cric-text">Social links</h2>
          <p className="mt-1 text-xs font-semibold text-cric-muted">Optional. You can add more later.</p>
          <div className="mt-4 space-y-3">
            {form.socialLinks.map(([key, value], index) => (
              <div key={index} className="grid gap-3 md:grid-cols-[200px_1fr_auto] md:items-center">
                <input
                  value={key}
                  onChange={(e) => setSocial(index, 0, e.target.value)}
                  placeholder="instagram"
                  className={input}
                  maxLength={30}
                />
                <input
                  value={value}
                  onChange={(e) => setSocial(index, 1, e.target.value)}
                  placeholder="https://instagram.com/yourclub"
                  className={input}
                />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, socialLinks: f.socialLinks.filter((_, i) => i !== index) }))}
                  className="rounded-lg border border-red-300 bg-white px-5 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, socialLinks: [...f.socialLinks, ["", ""]] }))}
            className="mt-4 rounded-lg border border-cric-border bg-cric-bg px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted"
          >
            + Add another link
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/organization" className={secondaryButton}>
            Cancel
          </Link>
          <button type="submit" disabled={busy || form.name.trim().length < 2} className={primaryButton}>
            {busy ? "Creating…" : "Create organization"}
          </button>
        </div>
      </form>
    </div>
  );
}
