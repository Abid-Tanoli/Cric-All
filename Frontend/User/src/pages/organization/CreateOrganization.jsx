import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createOrganization, listMyOrganizations, listOrganizationTypes } from "../../services/organizationApi";
import { getStoredUser } from "../auth/auth";
import { Banner, Field, card, eyebrow, input, primaryButton, secondaryButton } from "./orgStyles";

const emptyForm = {
  name: "",
  shortName: "",
  type: "other",
  description: "",
  website: "",
  location: { city: "", area: "", address: "", country: "" },
  contact: { phone: "", email: "" },
  socialLinks: [["", ""]],
  privacy: { contactInfo: "public", socialLinks: "public", location: "public" },
};

export default function CreateOrganization() {
  const navigate = useNavigate();
  const storedUser = getStoredUser();

  const [form, setForm] = useState(emptyForm);
  const [types, setTypes] = useState([]);
  const [parents, setParents] = useState([]);
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    listOrganizationTypes()
      .then((res) => setTypes(Array.isArray(res) ? res : []))
      .catch(() => setTypes([]));
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
      };
      if (parent) payload.parent = parent;

      const res = await createOrganization(payload);
      navigate(`/organization?org=${res.organization._id}`);
    } catch (error) {
      setErr(error.message || "Could not create the organization");
    } finally {
      setBusy(false);
    }
  };

  if (!storedUser) return null;

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

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Type" hint="Drawn from the platform category list.">
              {types.length > 0 ? (
                <select value={form.type} onChange={setTop("type")} className={input}>
                  {types.map((category) => (
                    <option key={category._id} value={category.slug || category.name.toLowerCase()}>
                      {category.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={form.type} onChange={setTop("type")} className={input} />
              )}
            </Field>
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
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="City">
              <input value={form.location.city} onChange={setNested("location", "city")} className={input} />
            </Field>
            <Field label="Area">
              <input value={form.location.area} onChange={setNested("location", "area")} className={input} />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Country">
              <input value={form.location.country} onChange={setNested("location", "country")} className={input} />
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
