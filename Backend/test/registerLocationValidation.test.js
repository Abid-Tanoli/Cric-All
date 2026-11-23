import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Location from "../src/models/Location.js";
import Player from "../src/models/Player.js";
import { registerUser } from "../src/controllers/authController.js";
import validate from "../src/middleware/validate.js";
import { registerSchema } from "../src/validators/authValidators.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

test("register persists the Register.jsx locationRefs and locationLabels on the new player", async () => {
  const ids = {
    country: "65b100000000000000000001",
    province: "65b100000000000000000002",
    district: "65b100000000000000000003",
    city: "65b100000000000000000004",
  };

  // The model resolves ids against the tree on save, so seed the exact branch
  // the form selected before sending the registration payload.
  const country = await Location.create({
    _id: new mongoose.Types.ObjectId(ids.country),
    type: "country",
    name: "Pakistan",
  });
  const province = await Location.create({
    _id: new mongoose.Types.ObjectId(ids.province),
    type: "province",
    name: "Sindh",
    parent: country._id,
  });
  const district = await Location.create({
    _id: new mongoose.Types.ObjectId(ids.district),
    type: "district",
    name: "Karachi Central",
    parent: province._id,
  });
  await Location.create({
    _id: new mongoose.Types.ObjectId(ids.city),
    type: "city",
    name: "Karachi",
    parent: district._id,
  });

  // Shape copied from Register.jsx -> register(): accountType/playerProfile,
  // with the tree selection nested in playerProfile.location.
  const payload = {
    name: "Register Location Tester",
    email: "register-location@example.com",
    password: "password123",
    accountType: "player",
    playerProfile: {
      playingRole: "Batsman",
      battingPosition: "",
      battingStyle: "Right-handed",
      bowlingStyle: "Right-arm Fast",
      category: "Other",
      subCategory: "",
      ageGroup: "Open",
      organizationName: "",
      location: {
        town: "",
        district: "Karachi Central",
        city: "Karachi",
        province: "Sindh",
        locationRefs: {
          countryId: ids.country,
          provinceId: ids.province,
          districtId: ids.district,
          cityId: ids.city,
          townId: null,
        },
        locationLabels: {
          country: "Pakistan",
          province: "Sindh",
          district: "Karachi Central",
          city: "Karachi",
          town: "",
        },
      },
    },
  };

  const req = mockReq({ body: payload });
  const validationRes = mockRes();
  let nextCalled = false;
  validate(registerSchema)(req, validationRes, () => { nextCalled = true; });
  assert.equal(
    nextCalled,
    true,
    validationRes.body ? JSON.stringify(validationRes.body) : "validate() never called next()"
  );
  assert.deepEqual(
    req.body.playerProfile.location.locationRefs,
    payload.playerProfile.location.locationRefs,
    "registerSchema must not strip the nested tree ids"
  );
  assert.deepEqual(
    req.body.playerProfile.location.locationLabels,
    payload.playerProfile.location.locationLabels,
    "registerSchema must not strip the nested tree labels"
  );

  const res = mockRes();
  await registerUser(req, res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));

  const player = await Player.findOne({ name: payload.name });
  assert.ok(player, "registration created the player profile");

  const refs = payload.playerProfile.location.locationRefs;
  assert.equal(String(player.locationRefs.countryId), refs.countryId);
  assert.equal(String(player.locationRefs.provinceId), refs.provinceId);
  assert.equal(String(player.locationRefs.districtId), refs.districtId);
  assert.equal(String(player.locationRefs.cityId), refs.cityId);
  assert.equal(player.locationRefs.townId, null);

  const labels = payload.playerProfile.location.locationLabels;
  assert.equal(player.locationLabels.country, labels.country);
  assert.equal(player.locationLabels.province, labels.province);
  assert.equal(player.locationLabels.district, labels.district);
  assert.equal(player.locationLabels.city, labels.city);
  assert.equal(player.locationLabels.town, labels.town);
});
