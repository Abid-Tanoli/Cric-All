import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please use a valid email format"],
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
    minlength: [8, "Password must be at least 8 characters"],
    select: false,
  },
  // False until the owner proves control of the mailbox (or Google verifies it
  // server-side). Privileged actions are gated on this via requireVerifiedEmail.
  emailVerified: { type: Boolean, default: false },
  emailVerifiedAt: { type: Date, default: undefined },
  // Every identity that has ever been linked to this account.
  authProviders: {
    type: [{
      _id: false,
      provider: { type: String, enum: ["password", "google"], required: true },
      providerUserId: { type: String, default: "" },
    }],
    default: [],
  },
  // False for Google-only accounts that never chose a password.
  passwordSet: { type: Boolean, default: false },
  status: { type: String, enum: ["active", "suspended"], default: "active" },
  lastLoginAt: { type: Date, default: undefined },
  // Bumped whenever sessions must be invalidated wholesale (password reset,
  // Google linking that drops a password, suspension). Compared against the
  // `tv` claim in the JWT by `protect`.
  tokenVersion: { type: Number, default: 0 },
  // Email verification: random token stored hashed, single-use, expiring.
  emailVerificationToken: { type: String, select: false, default: undefined },
  emailVerificationExpires: { type: Date, default: undefined },
  verificationSentAt: { type: Date, default: undefined },
  role: {
    type: String,
    enum: ["admin", "scorer", "viewer"],
    default: "viewer",
    select: true,
  },
  accountType: {
    type: String,
    enum: ["player", "handler", "organization_admin", "viewer"],
    default: "viewer",
  },
  organizationCategory: {
    type: String,
    enum: ["School", "College", "University", "Organization", "Business", "Industry", "Club", "Academy", "League", "Other", ""],
    default: "",
  },
  organizationName: { type: String, trim: true, default: "" },
  phone: { type: String, trim: true, default: "" },
  joinIntent: { type: String, trim: true, default: "" },
  resetPasswordToken: { type: String, select: false, default: undefined },
  resetPasswordExpires: { type: Date, default: undefined },
}, { timestamps: true });

userSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  this.passwordSet = true;
});

userSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.virtual("confirmPassword")
  .set(function(value) {
    this._confirmPassword = value;
  })
  .get(function() {
    return this._confirmPassword;
  });

userSchema.set("toJSON", { virtuals: true });
userSchema.set("toObject", { virtuals: true });

export default mongoose.model("User", userSchema);
