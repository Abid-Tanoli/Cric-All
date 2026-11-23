// `validate.js` answers 400 { message: "Validation failed", errors: [...] }.
// Map those Zod issues to the form fields they belong to so each control can
// show its own message instead of just the generic banner.

export function orgFormErrors(error) {
  const issues = error?.response?.data?.errors;
  const out = {};
  if (!Array.isArray(issues)) return out;

  for (const issue of issues) {
    const base = Array.isArray(issue.path) ? issue.path.map(String) : [];
    // An unrecognized_keys issue names the keys on its `keys` array, not path.
    const keys = Array.isArray(issue.keys) && issue.keys.length ? issue.keys.map(String) : [];
    const paths = keys.length ? keys.map((key) => [...base, key]) : [base];
    for (const path of paths) {
      const field = path.join(".");
      if (field && !out[field]) out[field] = issue.message || "Invalid value";
    }
  }
  return out;
}

export function fieldError(errors, field) {
  if (!errors) return "";
  if (errors[field]) return errors[field];
  // A group (e.g. `typeDetails`) can receive a nested issue for one of its inputs.
  const prefix = `${field}.`;
  const nested = Object.keys(errors).find((key) => key.startsWith(prefix));
  return nested ? errors[nested] : "";
}
