import Admin from "../models/Admin.js";
import { generateToken } from "../utils/jwt.js";
import bcrypt from "bcryptjs";

export const registerAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const adminCount = await Admin.countDocuments();
    if (adminCount > 0) {
      return res.status(403).json({ message: "Admin registration is closed. Login with an existing admin account." });
    }

const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ message: "Admin already exists" });

    // The very first admin created is the one-time bootstrap account.
    // It must always be a superadmin regardless of the request body.
    const role = adminCount === 0 ? "superadmin" : "admin";
    const admin = await Admin.create({ name, email, password, role });
    const token = generateToken(admin);

    res.status(201).json({ token, user: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ message: "Admin already exists" });

    // A superadmin cannot mint another superadmin through this endpoint.
    const admin = await Admin.create({ name, email, password, role: "admin" });
    const created = await Admin.findById(admin._id).select("-password");

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = generateToken(admin);

    res.json({ token, user: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getAdminProfile = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.json(admin);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().select("-password");
    res.json(admins);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;
    const requester = req.user;

    const admin = await Admin.findById(id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const isSelf = String(requester._id) === String(admin._id);

    if (payload.role && String(payload.role) !== String(admin.role)) {
      if (isSelf) {
        return res.status(400).json({ message: "You cannot change your own role" });
      }
      if (requester.role !== "superadmin") {
        return res.status(403).json({ message: "Only a super admin can change another admin's role" });
      }
      if (!["admin", "superadmin"].includes(payload.role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      admin.role = payload.role;
    }

    admin.name = payload.name ?? admin.name;
    admin.email = payload.email ?? admin.email;
    if (payload.password) admin.password = payload.password;

    await admin.save();
    const updated = await Admin.findById(id).select("-password");
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const requester = req.user;

    if (String(requester._id) === String(id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    await Admin.findByIdAndDelete(id);
    res.json({ message: "Admin deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
