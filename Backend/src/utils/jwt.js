import jwt from "jsonwebtoken";

// `tv` (token version) lets us invalidate every outstanding token for a user in
// one write. Tokens issued before this claim existed carry no `tv`, which we
// read as 0 — the default on the User document — so they stay valid until the
// user's tokenVersion is bumped.
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id?.toString(),
      email: user.email,
      role: user?.role || 'viewer',
      tv: user?.tokenVersion ?? 0
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};
