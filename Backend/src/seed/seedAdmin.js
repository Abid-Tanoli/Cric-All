import "dotenv/config";
import connectDB from "../utils/db.js";
import Admin from "../models/Admin.js";

const DEFAULT_ADMIN = {
  name: "Super Admin",
  email: "admin@cric-all.com",
  password: "admin123",
};

async function seedAdmin() {
  try {
    await connectDB();

    const existing = await Admin.findOne({ email: DEFAULT_ADMIN.email });
    if (existing) {
      console.log("Admin already exists with email:", DEFAULT_ADMIN.email);
      console.log("Login credentials:");
      console.log("  Email:    admin@cric-all.com");
      console.log("  Password: admin123");
      process.exit(0);
    }

    const admin = await Admin.create(DEFAULT_ADMIN);
    console.log("Default admin created successfully!");
    console.log("  ID:      ", admin._id);
    console.log("  Name:    ", admin.name);
    console.log("  Email:   ", admin.email);
    console.log("  Password:", DEFAULT_ADMIN.password);
    console.log("\nLogin at: http://localhost:5174/admin/login");
    process.exit(0);
  } catch (err) {
    console.error("Failed to seed admin:", err.message);
    process.exit(1);
  }
}

seedAdmin();
