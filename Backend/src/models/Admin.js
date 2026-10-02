import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "superadmin"], default: "admin" },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date },
    // Claims the one-time first-admin bootstrap. Exactly one document in the
    // whole collection may carry this value, enforced by MongoDB itself, so two
    // simultaneous POST /admin/register requests cannot both win - a
    // countDocuments() check cannot promise that, because both requests observe
    // the empty collection before either one writes.
    //
    // Sparse, so every admin created afterwards (which simply omits the field)
    // is ignored by the index and can be added freely.
    bootstrapClaim: { type: String, select: false, default: undefined },
  },
  { timestamps: true }
);

// The atomic guard. A duplicate-key error on this index is the signal that the
// bootstrap has already been taken, and it is the only correct place to make
// that decision: it cannot be observed by a second writer.
adminSchema.index({ bootstrapClaim: 1 }, { unique: true, sparse: true, name: "uniq_admin_bootstrap_claim" });

adminSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

adminSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model("Admin", adminSchema);
