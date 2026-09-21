import "dotenv/config";
import connectDB from "../utils/db.js";
import Admin from "../models/Admin.js";

const seedAdminEmail = process.env.SEED_ADMIN_EMAIL;
const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;

if (!seedAdminEmail || !seedAdminPassword) {
  console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running the seed script.");
  process.exit(1);
}

const DEFAULT_ADMIN = {
  name: "Super Admin",
  email: seedAdminEmail,
  password: seedAdminPassword,
};

async function seedAdmin() {
  try {
    await connectDB();

    // In production, never create/reseed an admin if admins already exist.
    if (process.env.NODE_ENV === "production") {
      const existingAdminCount = await Admin.countDocuments({});
      if (existingAdminCount > 0) {
        console.error("Admins already exist — refusing to reseed in production.");
        process.exit(1);
      }
    }

    const existing = await Admin.findOne({ email: DEFAULT_ADMIN.email });
    if (existing) {
      console.log("Admin already exists with email:", DEFAULT_ADMIN.email);
      process.exit(0);
    }

    const admin = await Admin.create(DEFAULT_ADMIN);
    console.log("Default admin created successfully!");
    console.log("  ID:      ", admin._id);
    console.log("  Name:    ", admin.name);
    console.log("  Email:   ", admin.email);
    console.log("\nLogin at: http://localhost:5174/admin/login");
    process.exit(0);
  } catch (err) {
    console.error("Failed to seed admin:", err.message);
    process.exit(1);
  }
}

seedAdmin();
