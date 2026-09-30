import React, { useEffect, useMemo, useState } from "react";
import { deleteOrganization, listOrganizationTypes, updateOrganization } from "../../services/organizationApi";
import { PERMISSIONS, can } from "../../lib/orgUi";
import {
  Banner,
  Field,
  card,
  cardSubtle,
  dangerButton,
  eyebrow,
  input,
  primaryButton,
  sectionTitle,
} from "./orgStyles";

const SOCIAL_PRESETS = ["facebook", "instagram", "x", "youtube", "linkedin", "tiktok", "whatsapp", "telegram"];

const emptyForm = (org) => ({
  name: org?.name || "",
  shortName: org?.shortName || "",
  type: org?.type || "other",
  description: org?.description || "",
  website: org?.website || "",
  logoUrl: org?.logoUrl || "",
  coverUrl: org?.coverUrl || "",
  foundedYear: org?.foundedYear || "",
  location: {
    city: org?.location?.city || "",
    area: org?.location?.area || "",
    address: org?.location?.address || "",
    country: org?.location?.country || "",
  },
  contact: {
    phone: org?.contact?.phone || "",
    email: org?.contact?.email || "",
  },
  socialLinks: Object.entries(org?.socialLinks || {}),
  privacy: {
    contactInfo: org?.privacy?.contactInfo || "public",
    socialLinks: org?.privacy?.socialLinks || "public",
    location: org?.privacy?.location || "public",
  },
});

export default function OrgSettings({ org, access, onSaved, onDeleted }) {
  const [form, setForm] = useState(() => emptyForm(org));
  const [types, setTypes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const permissions = access?.permissions || [];
  const editable = can(permissions, PERMISSIONS.MANAGE_ORG);

  // The form is (re)seeded from `org` by remounting this component under a new
  // key at the call site, so there is no "reset on change" effect here.

  useEffect(() => {
    listOrganizationTypes()
      .then((res) => setTypes(Array.isArray(res) ? res : []))
      .catch(() => setTypes([]));
  }, []);

  // A Map comes back as a plain object from JSON; normalise both shapes.
  const socialEntries = useMemo(() => form.socialLinks, [form.socialLinks]);

  const setTop = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const setNested = (group, key) => (event) =>
    setForm((f) => ({ ...f, [group]: { ...f[group], [key]: event.target.value } }));

  const addSocial = () => setForm((f) => ({ ...f, socialLinks: [...f.socialLinks, ["", ""]] }));
  const updateSocial = (index, position, value) =>
    setForm((f) => {
      const next = f.socialLinks.map((pair) => [...pair]);
      next[index][position] = value;
      return { ...f, socialLinks: next };
    });
  const removeSocial = (index) =>
    setForm((f) => ({ ...f, socialLinks: f.socialLinks.filter((_, i) => i !== index) }));

  const socialPayload = () => {
    const out = {};
    for (const [key, value] of socialEntries) {
      const cleanKey = key.trim().toLowerCase();
      const cleanValue = value.trim();
      if (cleanKey && cleanValue) out[cleanKey] = cleanValue;
    }
    return out;
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const payload = {
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        type: form.type,
        description: form.description.trim(),
        website: form.website.trim(),
        logoUrl: form.logoUrl.trim(),
        coverUrl: form.coverUrl.trim(),
        foundedYear: form.foundedYear === "" ? null : Number(form.foundedYear),
        location: {
          city: form.location.city.trim(),
          area: form.location.area.trim(),
          address: form.location.address.trim(),
          country: form.location.country.trim(),
        },
        contact: {
          phone: form.contact.phone.trim(),
          email: form.contact.email.trim(),
        },
        socialLinks: socialPayload(),
        privacy: { ...form.privacy },
      };
      const res = await updateOrganization(org._id, payload);
      setNotice(res.message || "Organization updated.");
      setForm(emptyForm(res.organization));
      onSaved?.(res.organization);
    } catch (error) {
      setErr(error.message || "Could not save the organization");
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    setErr("");
    try {
      await deleteOrganization(org._id);
      onDeleted?.(org);
    } catch (error) {
      setErr(error.message || "Could not delete the organization");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const privacySelect = (key) => (
    <select value={form.privacy[key]} onChange={setNested("privacy", key)} className={input}>
      <option value="public">Public</option>
      <option value="hidden">Hidden</option>
    </select>
  );

  return (
    <form onSubmit={save} className="space-y-4">
      <div className={card}>
        <h2 className={sectionTitle}>Organization settings</h2>
        <p className="mt-1 text-xs font-semibold text-cric-muted">
          {editable
            ? "Changes take effect immediately and are recorded in the activity log."
            : "Your roles do not allow changing these details."}
        </p>

        {err ? <div className="mt-4"><Banner kind="error">{err}</Banner></div> : null}
        {notice ? <div className="mt-4"><Banner kind="success">{notice}</Banner></div> : null}

        <fieldset disabled={!editable || busy} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name *">
              <input value={form.name} onChange={setTop("name")} className={input} required minLength={2} maxLength={150} />
            </Field>
            <Field label="Short name" hint="Shown next to the full name in lists.">
              <input value={form.shortName} onChange={setTop("shortName")} className={input} maxLength={20} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Type" hint="Chosen from the platform's category list.">
              {types.length > 0 ? (
                <select value={form.type} onChange={setTop("type")} className={input}>
                  {types.map((category) => (
                    <option key={category._id} value={category.slug || category.name.toLowerCase()}>
                      {category.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={form.type} onChange={setTop("type")} className={input} placeholder="other" />
              )}
            </Field>
            <Field label="Website">
              <input value={form.website} onChange={setTop("website")} className={input} placeholder="https://…" />
            </Field>
            <Field label="Founded (year)">
              <input
                type="number"
                value={form.foundedYear}
                onChange={setTop("foundedYear")}
                className={input}
                min={1800}
                max={new Date().getFullYear() + 1}
              />
            </Field>
          </div>

          <Field label="About">
            <textarea value={form.description} onChange={setTop("description")} rows={4} className={input} maxLength={2000} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Logo URL">
              <input value={form.logoUrl} onChange={setTop("logoUrl")} className={input} placeholder="https://…" />
            </Field>
            <Field label="Cover image URL">
              <input value={form.coverUrl} onChange={setTop("coverUrl")} className={input} placeholder="https://…" />
            </Field>
          </div>
        </fieldset>
      </div>

      <div className={card}>
        <h2 className={sectionTitle}>Location &amp; contact</h2>
        <fieldset disabled={!editable || busy} className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="City">
              <input value={form.location.city} onChange={setNested("location", "city")} className={input} />
            </Field>
            <Field label="Area">
              <input value={form.location.area} onChange={setNested("location", "area")} className={input} />
            </Field>
          </div>
          <Field label="Address">
            <input value={form.location.address} onChange={setNested("location", "address")} className={input} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Country">
              <input value={form.location.country} onChange={setNested("location", "country")} className={input} />
            </Field>
            <Field label="Contact phone">
              <input value={form.contact.phone} onChange={setNested("contact", "phone")} className={input} />
            </Field>
          </div>
          <Field label="Public contact email">
            <input type="email" value={form.contact.email} onChange={setNested("contact", "email")} className={input} />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Location visibility">{privacySelect("location")}</Field>
            <Field label="Contact visibility">{privacySelect("contactInfo")}</Field>
            <Field label="Social links visibility">{privacySelect("socialLinks")}</Field>
          </div>
        </fieldset>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={sectionTitle}>Social links</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              {can(permissions, PERMISSIONS.MANAGE_SOCIAL_LINKS) || editable
                ? "Add any network — the list is not limited to the presets."
                : "Only owners and admins can change these."}
            </p>
          </div>
          <button
            type="button"
            onClick={addSocial}
            disabled={!editable || busy}
            className="rounded-lg border border-cric-border bg-cric-bg px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted disabled:opacity-50"
          >
            + Add link
          </button>
        </div>

        <fieldset disabled={!editable || busy} className="mt-4 space-y-3">
          {socialEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cric-border bg-cric-bg p-5 text-center text-xs font-semibold text-cric-muted">
              No social links yet.
            </div>
          ) : (
            socialEntries.map(([key, value], index) => (
              <div key={index} className={`${cardSubtle} grid gap-3 md:grid-cols-[200px_1fr_auto] md:items-center`}>
                <input
                  value={key}
                  onChange={(e) => updateSocial(index, 0, e.target.value)}
                  placeholder="instagram"
                  list="social-presets"
                  className={input}
                  maxLength={30}
                />
                <input
                  value={value}
                  onChange={(e) => updateSocial(index, 1, e.target.value)}
                  placeholder="https://instagram.com/yourclub"
                  className={input}
                />
                <button type="button" onClick={() => removeSocial(index)} className={dangerButton}>
                  Remove
                </button>
              </div>
            ))
          )}
        </fieldset>
        <datalist id="social-presets">
          {SOCIAL_PRESETS.map((preset) => (
            <option key={preset} value={preset} />
          ))}
        </datalist>
      </div>

      {editable && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className={sectionTitle}>Danger zone</h2>
              <p className="mt-1 text-xs font-semibold text-cric-muted">
                Deleting removes the organization and its membership rows. It is only possible when the
                organization has no teams and no sub-organizations.
              </p>
            </div>
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className={dangerButton}>
              Delete organization
            </button>
          </div>

          {confirmDelete && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-700">
                Delete “{org.name}”? This cannot be undone.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={destroy}
                  disabled={busy}
                  className="rounded-lg bg-red-600 px-5 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-cric-border bg-white px-5 py-2 text-xs font-black uppercase tracking-widest text-cric-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {editable && (
        <div className="flex justify-end">
          <button type="submit" disabled={busy || form.name.trim().length < 2} className={primaryButton}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      <p className={`text-right ${eyebrow}`}>
        Verification is handled by the CricAll platform team, not by members.
      </p>
    </form>
  );
}
