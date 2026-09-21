import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { register as registerAction, clearError } from "../../store/slices/authSlice";
import PasswordField from "../../components/PasswordField";

const RegisterSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function AdminRegister() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading, error, token } = useSelector((state) => state.auth);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(RegisterSchema),
  });

  useEffect(() => {
    if (token) {
      navigate("/admin");
    }
  }, [token, navigate]);

  useEffect(() => {
    return () => {
      dispatch(clearError());
    };
  }, [dispatch]);

  const onSubmit = async (data) => {
    await dispatch(registerAction({
      name: data.name,
      email: data.email,
      password: data.password,
    }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cric-bg p-6">
      <div className="w-full max-w-md">
        <div className="bg-cric-card rounded-2xl shadow-xl p-8 border border-cric-border">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black text-cric-text">CREATE ACCOUNT</h1>
            <p className="text-cric-muted mt-2">Join the CricAll Admin Panel</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase text-cric-muted mb-2">
                Full Name
              </label>
              <input
                {...register("name")}
                type="text"
                className="w-full px-4 py-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text"
                placeholder="John Doe"
              />
              {errors.name && (
                <p className="mt-2 text-xs text-red-500 font-bold">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-cric-muted mb-2">
                Email Address
              </label>
              <input
                {...register("email")}
                type="email"
                className="w-full px-4 py-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text"
                placeholder="admin@cricall.com"
              />
              {errors.email && (
                <p className="mt-2 text-xs text-red-500 font-bold">{errors.email.message}</p>
              )}
            </div>

            <PasswordField
              label="Password"
              placeholder="••••••••"
              error={errors.password?.message}
              inputProps={register("password")}
            />
            <PasswordField
              label="Confirm Password"
              placeholder="••••••••"
              error={errors.confirmPassword?.message}
              inputProps={register("confirmPassword")}
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-cric-accent hover:bg-orange-600 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg"
            >
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-cric-muted">
            Already have an account?{" "}
            <Link to="/admin/login" className="text-cric-accent font-bold hover:underline">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
