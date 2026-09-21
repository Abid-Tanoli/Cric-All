import React, { useEffect, useState } from "react";
import api from "../services/api";

// Renders the arbitrarily-deep TeamOrganization hierarchy as nested dropdowns.
// The admin drills from root down to a leaf; the deepest selected node is the
// value. There is no hard depth limit: every level offers a "+ Add
// sub-organization" control that inline-creates a child under the current
// selection, and the admin can stop at any level ("-- Stop here --").
export default function OrganizationPicker({
  value = null,
  valueName = "",
  onChange = () => {},
}) {
  const [chain, setChain] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingAt, setAddingAt] = useState(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [addError, setAddError] = useState("");

  const deepestSelected = (levels = chain) => {
    const copy = [...levels].reverse();
    const found = copy.find((l) => l.selected);
    return found?.selected || null;
  };

  const emitLeaf = (levels) => {
    const leaf = deepestSelected(levels);
    onChange(leaf?._id || null, leaf?.name || "");
  };

  useEffect(() => {
    let cancelled = false;

    const buildChainForValue = async (orgValue) => {
      try {
        const chainRes = await api.get(`/organizations/${orgValue}/chain`);
        const items = Array.isArray(chainRes.data) ? chainRes.data : [];
        if (items.length === 0) {
          await buildRootLevel();
          return;
        }

        const built = [];
        for (let i = 0; i < items.length; i++) {
          if (i === 0) {
            const rootsRes = await api.get("/organizations/roots");
            const roots = Array.isArray(rootsRes.data) ? rootsRes.data : [];
            built.push({
              level: 0,
              orgs: roots,
              selected: roots.find((r) => r._id === items[i]._id) || items[i],
            });
          } else {
            const childRes = await api.get(`/organizations/${items[i - 1]._id}/children`);
            const children = Array.isArray(childRes.data) ? childRes.data : [];
            built.push({
              level: i,
              orgs: children,
              selected: children.find((c) => c._id === items[i]._id) || items[i],
            });
          }
        }
        if (cancelled) return;
        setChain(built);
        emitLeaf(built);
      } catch (e) {
        console.error(e);
        if (!cancelled) await buildRootLevel();
      }
    };

    const buildRootLevel = async () => {
      try {
        const rootsRes = await api.get("/organizations/roots");
        const roots = Array.isArray(rootsRes.data) ? rootsRes.data : [];
        if (cancelled) return;
        const levels = [{ level: 0, orgs: roots, selected: null }];
        setChain(levels);
        emitLeaf(levels);
      } catch (err) {
        console.error(err);
        if (!cancelled) setChain([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    if (value) {
      buildChainForValue(value).finally(() => { if (!cancelled) setLoading(false); });
    } else {
      buildRootLevel();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = async (levelIndex, orgId) => {
    const current = chain[levelIndex];
    const selectedOrg = orgId ? current.orgs.find((o) => o._id === orgId) || null : null;
    const newChain = chain.slice(0, levelIndex + 1);
    newChain[levelIndex] = { ...current, selected: selectedOrg };

    if (selectedOrg) {
      try {
        const res = await api.get(`/organizations/${orgId}/children`);
        const children = Array.isArray(res.data) ? res.data : [];
        if (children.length > 0) {
          newChain.push({ level: levelIndex + 1, orgs: children, selected: null });
        }
      } catch (e) {
        console.error(e);
      }
    }

    setChain(newChain);
    setAddingAt(null);
    emitLeaf(newChain);
  };

  const submitAdd = async () => {
    const name = newOrgName.trim();
    if (!name) return;

    const parentOrg = deepestSelected();
    const parentLevel = parentOrg
      ? chain.findIndex((l) => l.selected?._id === parentOrg._id)
      : -1;
    const childLevel = Math.max(parentLevel + 1, 0);

    setAddError("");
    try {
      const res = await api.post("/organizations", {
        name,
        parent: parentOrg?._id || null,
      });
      const created = res.data?.organization || res.data;

      let newChain;
      const childLevels = chain.slice(0, childLevel);
      if (parentOrg && childLevels[childLevel - 1]) {
        childLevels[childLevel - 1] = {
          ...childLevels[childLevel - 1],
          selected: { ...parentOrg },
        };
      }
      newChain = [...childLevels, { level: childLevel, orgs: [created], selected: created }];
      setChain(newChain);
      onChange(created._id, created.name);
      setNewOrgName("");
      setAddingAt(null);
    } catch (err) {
      setAddError(err.response?.data?.message || "Failed to add organization");
    }
  };

  const leaf = deepestSelected();

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-xs text-slate-500">Loading organizations...</p>
      ) : chain.length === 0 ? (
        <p className="text-xs text-slate-500">
          No organizations yet — add one below.
        </p>
      ) : (
        chain.map((level, i) => {
          const isDeepest = i === chain.length - 1;
          return (
            <div key={i} className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">
                {i === 0 ? "Organization" : `Sub Level ${i}`}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={level.selected?._id || ""}
                  onChange={(e) => handleSelect(i, e.target.value)}
                  className="flex-1 min-w-[180px] p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800"
                >
                  <option value="">
                    {i === 0 ? "-- Select Organization --" : "-- Stop here --"}
                  </option>
                  {level.orgs.map((o) => (
                    <option key={o._id} value={o._id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {isDeepest && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddingAt(addingAt === i ? null : i);
                      setAddError("");
                    }}
                    className="px-3 py-3 text-xs font-black uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
                  >
                    {leaf ? "+ Add sub-organization" : "+ Add organization"}
                  </button>
                )}
              </div>
              {addingAt === i && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submitAdd())}
                    placeholder={i === 0 ? "New organization name" : "New sub-organization name"}
                    className="flex-1 min-w-[180px] p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={submitAdd}
                    disabled={!newOrgName.trim()}
                    className="px-4 py-3 text-xs font-black uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 rounded-xl disabled:opacity-40 transition-colors"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {addError && <p className="text-xs text-red-500 font-bold">{addError}</p>}

      {!loading && chain.length > 0 && (
        <p className="text-xs text-slate-500 italic">
          Chain:{" "}
          {chain.filter((l) => l.selected).map((l) => l.selected.name).join(" → ") ||
            "None"}
        </p>
      )}

      {!loading && valueName && !leaf && (
        <p className="text-xs text-slate-500">Previously selected: {valueName}</p>
      )}
    </div>
  );
}