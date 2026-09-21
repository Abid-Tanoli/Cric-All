import User from "../models/User.js";
import Player from "../models/Player.js";
import { generateToken } from "../utils/jwt.js";
import { validatePasswordStrength } from "../utils/password.js";
import {
  generateResetToken,
  hashResetToken,
  getResetTokenExpiry,
  isResetTokenExpired,
} from "../utils/passwordReset.js";

const userFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

export const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      accountType = "viewer",
      organizationCategory = "",
      organizationName = "",
      phone = "",
      joinIntent = "",
      playerProfile
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const requestedType = ["player", "handler", "organization_admin", "viewer"].includes(accountType)
      ? accountType
      : "viewer";
    const role = requestedType === "handler" || requestedType === "organization_admin" ? "scorer" : "viewer";

    const newUser = await User.create({
      name,
      email,
      password,
      role,
      accountType: requestedType,
      organizationCategory,
      organizationName,
      phone,
      joinIntent
    });

    if (requestedType === "player" && playerProfile) {
      await Player.create({
        name,
        playingRole: playerProfile.playingRole || "",
        battingStyle: playerProfile.battingStyle || "",
        bowlingStyle: playerProfile.bowlingStyle || "",
        category: playerProfile.category || "Other",
        subCategory: playerProfile.subCategory || "",
        ageGroup: playerProfile.ageGroup || "Open",
        organization: playerProfile.organizationName || "",
        address: {
          town: playerProfile.location?.town || "",
          district: playerProfile.location?.district || "",
          city: playerProfile.location?.city || "",
          province: playerProfile.location?.province || "",
          country: "Pakistan"
        },
      });
    }

    const token = generateToken(newUser);

    res.status(201).json({
      token,
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        accountType: newUser.accountType,
        organizationCategory: newUser.organizationCategory,
        organizationName: newUser.organizationName,
      },
    });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ message: "Registration failed" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user);

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountType: user.accountType,
        organizationCategory: user.organizationCategory,
        organizationName: user.organizationName,
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Login failed" });
  }
};

export const logoutUser = async (req, res) => {
  res.json({ message: "Logged out successfully" });
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email }).select("+resetPasswordToken");
    if (user) {
      const token = generateResetToken();
      user.resetPasswordToken = hashResetToken(token);
      user.resetPasswordExpires = getResetTokenExpiry();
      await user.save();

      // TODO: send via email once an email service is configured
      console.log(`[User password reset] ${user.email}: ${userFrontendUrl}/reset-password/${token}`);
    }

    // Always return the same generic success message so we don't leak
    // which email addresses are registered.
    res.status(200).json({ message: "If an account exists for this email, a reset link has been sent" });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ message: "Password reset request failed" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required" });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const hashedToken = hashResetToken(token);
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
    }).select("+password +resetPasswordToken");

    if (!user || isResetTokenExpired(user.resetPasswordExpires)) {
      return res.status(400).json({ message: "Password reset token is invalid or has expired" });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successfully. You can now sign in." });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ message: "Password reset failed" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      accountType: user.accountType,
      organizationCategory: user.organizationCategory,
      organizationName: user.organizationName,
    });
  } catch (err) {
    console.error("Profile Error:", err);
    res.status(500).json({ message: "Profile fetch failed" });
  }
};
