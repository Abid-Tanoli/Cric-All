import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { normalizePhone } from "../utils/phone.js";

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
  },
  // Email and phone are alternative identifiers: signup needs at least one of
  // them (enforced in the register validator/controller), so neither is
  // `required` at the schema level. The unique+sparse index keeps one account
  // per address while allowing phone-only accounts to omit the field entirely
  // (a plain unique index would collide on two missing values).
  email: {
    type: String,
    unique: true,
    sparse: true,
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
  // Phone verification: the same token/expiry/resend/attempt design as email
  // verification, but the secret is a short numeric OTP instead of a link.
  phoneVerified: { type: Boolean, default: false },
  phoneVerifiedAt: { type: Date, default: undefined },
  phoneVerificationOtp: { type: String, select: false, default: undefined },
  phoneVerificationExpires: { type: Date, default: undefined },
  phoneVerificationSentAt: { type: Date, default: undefined },
  // Wrong guesses against the current OTP. After MAX attempts the code is
  // invalidated; a 6-digit code must not be brute-forceable.
  phoneVerificationAttempts: { type: Number, default: 0 },
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
  // Normalized digits-only form with country code (see utils/phone.js), e.g.
  // "923001234567". Empty string means "no phone on this account"; the unique
  // partial index below only covers non-empty values.
  phone: { type: String, trim: true, default: "" },
  joinIntent: { type: String, trim: true, default: "" },
  resetPasswordToken: { type: String, select: false, default: undefined },
  resetPasswordExpires: { type: Date, default: undefined },
}, { timestamps: true });

// One account per phone number. The partial filter keeps accounts without a
// phone (the empty-string default) out of the index, so they never collide.
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string", $gt: "" } } },
);

// Normalize on every write through the model so the unique index only ever
// compares canonical values. Legacy rows keep whatever they hold until they
// are next written (the migrateUserPhoneIdentity script normalizes those).
// No `next` callback: Mongoose 9 hooks are promise-based (see the
// normalizeSocialLinks hook in TeamOrganization).
userSchema.pre("validate", function normalizePhoneForStorage() {
  if ((this.isModified("phone") || this.isNew) && this.phone) {
    this.phone = normalizePhone(this.phone) || "";
  }
});

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
