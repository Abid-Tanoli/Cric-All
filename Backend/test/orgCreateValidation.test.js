import test from "node:test";
import assert from "node:assert/strict";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from "../src/validators/orgValidators.js";

// The payload CreateOrganization.jsx builds for the reported local_club flow:
// the single empty social-link row is dropped client-side, phone/about are "".
const payload = {
  name: "Eagle Eleven",
  shortName: "Eagle 11",
  type: "club",
  orgType: "local_club",
  createDefaultTeam: true,
  typeDetails: {},
  description: "",
  website: "",
  location: { city: "", area: "", address: "", country: "" },
  contact: { phone: "", email: "contact@eagle11.com" },
  socialLinks: {},
  privacy: { contactInfo: "public", socialLinks: "public", location: "public" },
  locationRefs: {
    countryId: "65b100000000000000000001",
    provinceId: "65b100000000000000000002",
    districtId: "65b100000000000000000003",
    cityId: "65b100000000000000000004",
    townId: null,
  },
  locationLabels: {
    country: "Pakistan",
    province: "Sindh",
    district: "Karachi Central",
    city: "Karachi",
    town: "",
  },
};

test("createOrganizationSchema accepts the User form's locationRefs and locationLabels", () => {
  const result = createOrganizationSchema.safeParse(payload);
  assert.equal(
    result.success,
    true,
    result.success ? "" : JSON.stringify(result.error.issues)
  );
  assert.deepEqual(result.data.locationRefs, payload.locationRefs);
  assert.deepEqual(result.data.locationLabels, payload.locationLabels);
  assert.equal(result.data.createDefaultTeam, true);
  assert.deepEqual(result.data.socialLinks, {});
});

test("updateOrganizationSchema accepts the same location blocks from OrgSettings", () => {
  const result = updateOrganizationSchema.safeParse({
    locationRefs: payload.locationRefs,
    locationLabels: payload.locationLabels,
  });
  assert.equal(
    result.success,
    true,
    result.success ? "" : JSON.stringify(result.error.issues)
  );
  assert.deepEqual(result.data.locationRefs, payload.locationRefs);
  assert.deepEqual(result.data.locationLabels, payload.locationLabels);
});

test("updateOrganizationSchema never adds a field the caller did not send", () => {
  assert.deepEqual(updateOrganizationSchema.parse({}), {});
  assert.deepEqual(updateOrganizationSchema.parse({ isPublic: false }), { isPublic: false });
  assert.deepEqual(updateOrganizationSchema.parse({ isActive: false }), { isActive: false });
  assert.equal(updateOrganizationSchema.safeParse({ owner: "x" }).success, false);
});
