// React is imported explicitly for the Admin app: its test transform uses
// the classic JSX runtime, where JSX needs the React binding in scope.
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchLocations, suggestLocation } from "../services/locationApi.js";

export const LOCATION_LEVELS = ["country", "province", "district", "city", "town"];

const LEVEL_LABELS = {
  country: "Country",
  province: "Province / Territory",
  district: "District",
  city: "City / Tehsil",
  town: "Town / Area",
};

const PARENT_LABEL = {
  province: "country",
  district: "province",
  city: "district",
  town: "city",
};

const emptyRefs = () => ({
  countryId: null,
  provinceId: null,
  districtId: null,
  cityId: null,
  townId: null,
});

const emptyLabels = () => ({ country: "", province: "", district: "", city: "", town: "" });

/**
 * Cascading Country > Province > District > City/Tehsil > Town/Area control.
 *
 * - each level is a searchable combobox (native datalist: keyboard + mobile safe)
 * - a level is disabled until its parent is chosen, and choosing a parent
 *   clears every level below it
 * - "Other (add new)" suggests an unapproved node through the API and selects it
 *   immediately, so the form can be saved with the pending value
 * - `value` / `labels` carry the server's denormalized refs, so editing an
 *   existing record pre-fills without a lookup per level
 */
export default function LocationSelect({
  value,
  labels,
  onChange,
  levels = LOCATION_LEVELS,
  disabled = false,
  compact = false,
  legacyHint = "",
  error = "",
  idPrefix,
  showLabels = true,
  defaultCountry = "Pakistan",
}) {
  const generatedId = useId();
  const baseId = idPrefix || `location-${generatedId.replace(/[:]/g, "")}`;
  const activeLevels = useMemo(
    () => LOCATION_LEVELS.filter((level) => levels.includes(level)),
    [levels]
  );

  const refs = { ...emptyRefs(), ...(value || {}) };
  const displayLabels = { ...emptyLabels(), ...(labels || {}) };

  const [options, setOptions] = useState({ country: [], province: [], district: [], city: [], town: [] });
  const [loading, setLoading] = useState({});
  const [queries, setQueries] = useState({});
  const [pending, setPending] = useState({}); // level -> { id, name }
  const [adding, setAdding] = useState(null); // level
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const defaultedCountry = useRef(false);

  // Resolve display names for pre-filled ids that arrived without labels.
  const [fetchedNames, setFetchedNames] = useState({});
  useEffect(() => {
    const missing = {};
    for (const level of activeLevels) {
      const id = refs[`${level}Id`];
      if (id && !displayLabels[level] && !pending[level]) missing[id] = level;
    }
    const ids = Object.keys(missing);
    if (!ids.length) return undefined;

    const controller = new AbortController();
    fetchLocations({ ids, limit: 50, signal: controller.signal })
      .then((rows) => {
        setFetchedNames((current) => {
          const next = { ...current };
          for (const row of rows) next[row._id] = row.name;
          return next;
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeLevels, refs.countryId, refs.provinceId, refs.districtId, refs.cityId, refs.townId, displayLabels.country, displayLabels.province, displayLabels.district, displayLabels.city, displayLabels.town, pending]);

  const loadLevel = useCallback(
    async (level, signal) => {
      const index = LOCATION_LEVELS.indexOf(level);
      const parentLevel = index > 0 ? LOCATION_LEVELS[index - 1] : null;
      const parentId = parentLevel ? refs[`${parentLevel}Id`] : null;
      if (parentLevel && !parentId) {
        setOptions((current) => ({ ...current, [level]: [] }));
        return;
      }
      setLoading((current) => ({ ...current, [level]: true }));
      try {
        const rows = await fetchLocations({ type: level, parent: parentId || "root", limit: 200, signal });
        setOptions((current) => ({ ...current, [level]: rows }));
      } catch (err) {
        if (err?.name !== "AbortError") {
          setOptions((current) => ({ ...current, [level]: [] }));
        }
      } finally {
        setLoading((current) => ({ ...current, [level]: false }));
      }
    },
    [refs.countryId, refs.provinceId, refs.districtId, refs.cityId, refs.townId]
  );

  useEffect(() => {
    const controller = new AbortController();
    for (const level of activeLevels) loadLevel(level, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevels.join(","), refs.countryId, refs.provinceId, refs.districtId, refs.cityId, refs.townId]);

  // Country defaults to Pakistan once the list is available, unless the record
  // already has a country (editing) or the caller excluded the country level.
  useEffect(() => {
    if (defaultedCountry.current) return;
    if (!defaultCountry) {
      defaultedCountry.current = true;
      return;
    }
    if (!activeLevels.includes("country") || refs.countryId) return;
    const pakistan = options.country.find(
      (row) => row.name?.toLowerCase() === String(defaultCountry).toLowerCase()
    );
    if (!pakistan) return;
    defaultedCountry.current = true;
    onChange?.({ ...refs, countryId: pakistan._id }, { ...displayLabels, country: pakistan.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.country.length, refs.countryId]);

  const clearFrom = (level, nextRefs, nextLabels) => {
    const start = LOCATION_LEVELS.indexOf(level) + 1;
    for (let index = start; index < LOCATION_LEVELS.length; index += 1) {
      const deeper = LOCATION_LEVELS[index];
      nextRefs[`${deeper}Id`] = null;
      nextLabels[deeper] = "";
    }
  };

  const commit = (level, node) => {
    const nextRefs = { ...refs, [`${level}Id`]: node?._id || null };
    const nextLabels = { ...displayLabels, [level]: node?.name || "" };
    clearFrom(level, nextRefs, nextLabels);
    setQueries((current) => {
      const next = { ...current, [level]: node?.name || "" };
      const start = LOCATION_LEVELS.indexOf(level) + 1;
      for (let index = start; index < LOCATION_LEVELS.length; index += 1) delete next[LOCATION_LEVELS[index]];
      return next;
    });
    setPending((current) => (node ? { ...current, [level]: { id: node._id, name: node.name } } : current));
    onChange?.(nextRefs, nextLabels);
  };

  // Text typed before the level's options finished loading is kept, and an exact
  // name match is committed as soon as the list arrives. Without this, a fast
  // typist on a slow connection loses their selection when the response lands.
  useEffect(() => {
    for (const level of activeLevels) {
      const text = String(queries[level] || "").trim().toLowerCase();
      if (!text) continue;
      const match = options[level].find((row) => row.name.toLowerCase() === text);
      if (match && String(refs[`${level}Id`] || "") !== String(match._id)) {
        commit(level, match);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const selectByName = (level, raw) => {
    const text = raw;
    setQueries((current) => ({ ...current, [level]: text }));
    if (!text.trim()) {
      if (refs[`${level}Id`]) commit(level, null);
      return;
    }
    const match = options[level].find((row) => row.name.toLowerCase() === text.trim().toLowerCase());
    if (match) commit(level, match);
    else if (refs[`${level}Id`]) commit(level, null);
  };

  const startAdd = (level) => {
    setAdding(level);
    setAddName(queries[level] || "");
    setAddError("");
  };

  const submitAdd = async () => {
    const level = adding;
    const index = LOCATION_LEVELS.indexOf(level);
    const parentLevel = index > 0 ? LOCATION_LEVELS[index - 1] : null;
    const parentId = parentLevel ? refs[`${parentLevel}Id`] : null;
    if (!parentId) {
      setAddError(`Choose a ${PARENT_LABEL[level] || "parent"} first.`);
      return;
    }
    if (addName.trim().length < 2) {
      setAddError("Enter at least two characters.");
      return;
    }
    setAddBusy(true);
    setAddError("");
    try {
      const location = await suggestLocation({ name: addName.trim(), type: level, parentId });
      setOptions((current) => ({
        ...current,
        [level]: [...current[level].filter((row) => row._id !== location._id), location].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      }));
      setPending((current) => ({ ...current, [level]: { id: location._id, name: location.name } }));
      const nextRefs = { ...refs, [`${level}Id`]: location._id };
      const nextLabels = { ...displayLabels, [level]: location.name };
      clearFrom(level, nextRefs, nextLabels);
      onChange?.(nextRefs, nextLabels);
      setQueries((current) => ({ ...current, [level]: location.name }));
      setAdding(null);
      setAddName("");
    } catch (err) {
      setAddError(err?.message || "Could not add that place.");
    } finally {
      setAddBusy(false);
    }
  };

  const currentName = (level) => {
    const id = refs[`${level}Id`];
    if (!id) return "";
    return (
      options[level].find((row) => row._id === id)?.name ||
      (pending[level]?.id === id ? pending[level].name : "") ||
      fetchedNames[id] ||
      displayLabels[level] ||
      ""
    );
  };

  const selectClass = compact
    ? "w-full rounded-lg border border-cric-border bg-cric-bg px-2.5 py-2 text-xs font-semibold text-cric-text disabled:opacity-50"
    : "w-full rounded-xl border border-cric-border bg-cric-bg px-3 py-3 text-sm font-semibold text-cric-text disabled:opacity-50";

  return (
    <div className="w-full space-y-3" data-testid="location-select">
      <div className={compact ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        {activeLevels.map((level) => {
          const index = LOCATION_LEVELS.indexOf(level);
          const parentLevel = index > 0 ? LOCATION_LEVELS[index - 1] : null;
          const parentId = parentLevel ? refs[`${parentLevel}Id`] : null;
          const isDisabled = disabled || (parentLevel && !parentId);
          const listId = `${baseId}-${level}-options`;
          const placeholder = isDisabled
            ? `Select ${PARENT_LABEL[level] || "parent"} first`
            : `Search ${LEVEL_LABELS[level].toLowerCase()}`;
          const inputId = `${baseId}-${level}`;
          const levelOptions = options[level];
          const selectedPending = pending[level];

          return (
            <div key={level} className="min-w-0">
              {showLabels && (
                <label htmlFor={inputId} className="mb-1 block text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  {LEVEL_LABELS[level]}
                </label>
              )}
              <input
                id={inputId}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-label={LEVEL_LABELS[level]}
                list={listId}
                autoComplete="off"
                disabled={isDisabled}
                placeholder={placeholder}
                value={queries[level] ?? currentName(level)}
                onChange={(event) => selectByName(level, event.target.value)}
                onBlur={() => setQueries((current) => ({ ...current, [level]: currentName(level) }))}
                className={selectClass}
              />
              <datalist id={listId}>
                {levelOptions.map((row) => (
                  <option key={row._id} value={row.name} />
                ))}
                {selectedPending && !levelOptions.some((row) => row._id === selectedPending.id) && (
                  <option value={selectedPending.name} />
                )}
              </datalist>
              {!isDisabled && loading[level] && (
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-cric-muted">Loading…</p>
              )}
              {!isDisabled && !loading[level] && levelOptions.length === 0 && (
                <p className="mt-1 text-[10px] font-bold text-cric-muted">
                  No {LEVEL_LABELS[level].toLowerCase()} found. Use “Other (add new)”.
                </p>
              )}
              {!isDisabled && level !== "country" && (
                <button
                  type="button"
                  onClick={() => startAdd(level)}
                  className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-accent hover:underline"
                >
                  + Other (add new)
                </button>
              )}
              {adding === level && (
                <div className="mt-2 space-y-2 rounded-xl border border-cric-border bg-cric-card p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
                    Add a new {LEVEL_LABELS[level].toLowerCase()}
                  </p>
                  <input
                    value={addName}
                    onChange={(event) => setAddName(event.target.value)}
                    placeholder={`New ${LEVEL_LABELS[level].toLowerCase()} name`}
                    aria-label={`New ${LEVEL_LABELS[level]} name`}
                    className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-sm font-semibold text-cric-text"
                  />
                  {addError && <p className="text-xs font-bold text-red-500">{addError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={submitAdd}
                      disabled={addBusy}
                      className="rounded-lg bg-cric-accent px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                    >
                      {addBusy ? "Saving…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdding(null)}
                      className="rounded-lg border border-cric-border px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {legacyHint && (
        <p className="text-[11px] font-semibold text-cric-muted">
          Saved address (legacy): <span className="text-cric-text">{legacyHint}</span>
        </p>
      )}
      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
    </div>
  );
}
