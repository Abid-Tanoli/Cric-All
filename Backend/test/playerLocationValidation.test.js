import test from "node:test";
import assert from "node:assert/strict";
import validate from "../src/middleware/validate.js";
import {
  createPlayerSchema,
  updatePlayerSchema,
  adminPlayerSchema,
  adminUpdatePlayerSchema,
} from "../src/validators/playerValidators.js";

// The blocks LocationSelect sends, as seen by POST/PUT /players. The payloads
// below mirror CreatePlayerProfile.jsx (self) and Shared/components/PlayerForm.jsx
// (admin), including the legacy address fields both forms keep alongside them.
const locationRefs = {
  countryId: "65b100000000000000000001",
  provinceId: "65b100000000000000000002",
  districtId: "65b100000000000000000003",
  cityId: "65b100000000000000000004",
  townId: null,
};
const locationLabels = {
  country: "Pakistan",
  province: "Sindh",
  district: "Karachi Central",
  city: "Karachi",
  town: "",
};
const withLocation = (payload) => ({ ...payload, locationRefs, locationLabels });

const selfPayload = withLocation({
  name: "Eagle Player",
  playingRole: "Batsman",
  battingPosition: "",
  battingStyle: "Right-handed",
  bowlingStyle: "Right-arm Fast",
  category: "Other",
  subCategory: "",
  ageGroup: "Open",
  organization: "",
  address: { district: "Karachi Central", city: "Karachi", province: "Sindh" },
});

const adminPayload = withLocation({
  name: "Eagle Player",
  playingRole: "Batsman",
  battingPosition: "",
  battingStyle: "Right-handed",
  bowlingStyle: "Right-arm Fast",
  team: "65b100000000000000000001",
  imageUrl: "",
  phone: "03001234567",
  jerseyNumber: 10,
  isPartTimeBowler: false,
  category: "Other",
  subCategory: "",
  ageGroup: "Open",
  organization: "",
  address: { district: "Karachi Central", city: "Karachi", province: "Sindh" },
  gallery: [],
  videos: [],
  socialLinks: { facebook: "", instagram: "", twitter: "", youtube: "", whatsapp: "" },
  privacy: { contactInfo: "public", socialLinks: "public", location: "public" },
});

// Run through the same middleware the routes use, not just schema.safeParse(),
// so a regression here shows up as the 400 the form actually receives.
function runMiddleware(schema, body) {
  const req = { body };
  let nextCalled = false;
  let response;
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      response = { status: this.statusCode, body: payload };
      return this;
    },
  };
  validate(schema)(req, res, () => { nextCalled = true; });
  return { req, nextCalled, response };
}

function assertAccepted(schema, payload) {
  const { req, nextCalled, response } = runMiddleware(schema, payload);
  assert.equal(
    nextCalled,
    true,
    response ? JSON.stringify(response) : "validate() never called next()"
  );
  assert.deepEqual(req.body.locationRefs, locationRefs);
  assert.deepEqual(req.body.locationLabels, locationLabels);
}

test("createPlayerSchema accepts LocationSelect blocks from CreatePlayerProfile", () => {
  assertAccepted(createPlayerSchema, selfPayload);
});

test("updatePlayerSchema accepts LocationSelect blocks from a self-service edit", () => {
  assertAccepted(updatePlayerSchema, selfPayload);
});

test("adminPlayerSchema accepts LocationSelect blocks from the Admin player form", () => {
  assertAccepted(adminPlayerSchema, adminPayload);
});

test("adminUpdatePlayerSchema accepts LocationSelect blocks from an Admin edit", () => {
  assertAccepted(adminUpdatePlayerSchema, adminPayload);
});
