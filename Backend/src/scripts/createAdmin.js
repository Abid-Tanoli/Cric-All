import dotenv from "dotenv";
import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import connectDB from "../utils/db.js";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function createAdmin() {
  const name = requireEnv("ADMIN_NAME");
  const email = requireEnv("ADMIN_EMAIL").toLowerCase();
  const password = requireEnv("ADMIN_PASSWORD");

  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  }

  const connection = await connectDB();
  if (!connection) {
    throw new Error("Database is not connected.");
  }

  const existingAdminCount = await Admin.countDocuments();
  if (existingAdminCount > 0) {
    console.log(`Admin creation skipped: ${existingAdminCount} admin account(s) already exist.`);
    return;
  }

  const existingEmail = await Admin.findOne({ email });
  if (existingEmail) {
    console.log("Admin creation skipped: an admin with that email already exists.");
    return;
  }

  // This is the bootstrap account, so it is a superadmin - the same role the
  // HTTP route grants. Creating a plain "admin" here would leave the platform
  // with nobody able to mint another admin, because /admin/create is itself
  // superadmin-only.
  //
  // bootstrapClaim is claimed here too, so the same unique index that closes
  // POST /admin/register also protects this path against a concurrent run.
  const admin = await Admin.create({ name, email, password, role: "superadmin", bootstrapClaim: "first-admin" });
  console.log(`Admin created: ${admin.email} (role: ${admin.role})`);
}

createAdmin()
  .catch((error) => {
    console.error("Admin creation failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
