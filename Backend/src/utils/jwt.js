import jwt from "jsonwebtoken";

export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id?.toString(),
      email: user.email,
      role: user?.role || 'viewer'
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};