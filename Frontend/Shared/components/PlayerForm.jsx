import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import PhotoInput from "./PhotoInput.jsx";

const userSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  playingRole: z.string().min(1, "Playing role is required"),
  battingStyle: z.string().min(1, "Batting style is required"),
  bowlingStyle: z.string().min(1, "Bowling style is required"),
  category: z.string().optional(),
  subCategory: z.string().optional(),
  ageGroup: z.string().optional(),
  organization: z.string().optional(),
  address: z.object({
    town: z.string().optional(),
    district: z.string().optional(),
    city: z.string().min(1, "City is required"),
    province: z.string().min(1, "Province is required"),
  }).optional(),
});

const adminSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  playingRole: z.string().min(1, "Playing role is required"),
  battingStyle: z.string().min(1, "Batting style is required"),
  bowlingStyle: z.string().min(1, "Bowling style is required"),
  team: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.string().optional(),
  subCategory: z.string().optional(),
  ageGroup: z.string().optional(),
  organization: z.string().optional(),
  address: z.object({
    town: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
  }).optional(),
});

const playingRoles = ["Batsman", "Bowler", "All-Rounder", "Batting-All-Rounder", "Bowling-All-Rounder", "Wicket-Keeper"];
const battingStyles = ["Right-handed", "Left-handed"];
const bowlingStyles = [
  "Right-arm Fast", "Right-arm Fast-Medium", "Right-arm Medium",
  "Right-arm Off-break", "Right-arm Leg-break",
  "Left-arm Fast", "Left-arm Orthodox", "Not Applicable"
];
const categories = ["School", "College", "University", "Organization", "Business", "Industry", "Club", "International", "Other"];
const ageGroups = ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"];

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-[9px] font-black uppercase tracking-widest text-cric-muted mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({ register, name, children, error, ...props }) {
  return (
    <>
      <select
        {...register(name)}
        className="w-full p-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text transition-all"
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-[10px] font-bold text-red-500">{error}</p>}
    </>
  );
}

function Input({ register, name, type = "text", placeholder, error, ...props }) {
  return (
    <>
      <input
        {...register(name)}
        type={type}
        className="w-full p-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text transition-all"
        placeholder={placeholder}
        {...props}
      />
      {error && <p className="mt-1 text-[10px] font-bold text-red-500">{error}</p>}
    </>
  );
}

export default function PlayerForm({
  mode = "admin",
  onSubmit,
  teams = [],
  loading = false,
  editingId = null,
  defaultValues = {},
  onCancel,
  submitButtonText,
}) {
  const schema = mode === "user" ? userSchema : adminSchema;
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const handleFormSubmit = async (data) => {
    await onSubmit(data);
  };

  const buttonText = submitButtonText || (
    mode === "user" ? "Create Player Account"
    : editingId ? "Update File"
    : "Enlist Player"
  );

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      {mode === "user" && (
        <>
          <FormField label="Email Address">
            <Input register={register} name="email" type="email" placeholder="your@email.com" error={errors.email?.message} />
          </FormField>
          <FormField label="Password">
            <Input register={register} name="password" type="password" placeholder="Minimum 8 characters" error={errors.password?.message} />
          </FormField>
        </>
      )}

      <FormField label="Full Name">
        <Input register={register} name="name" placeholder="Enter full name" error={errors.name?.message} />
      </FormField>

      <FormField label="Playing Role">
        <Select register={register} name="playingRole" error={errors.playingRole?.message}>
          <option value="">Select Role</option>
          {playingRoles.map(r => <option key={r} value={r}>{r}</option>)}
        </Select>
      </FormField>

      <FormField label="Batting Style">
        <Select register={register} name="battingStyle" error={errors.battingStyle?.message}>
          <option value="">Select Style</option>
          {battingStyles.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
      </FormField>

      <FormField label="Bowling Style">
        <Select register={register} name="bowlingStyle" error={errors.bowlingStyle?.message}>
          <option value="">Select Style</option>
          {bowlingStyles.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
      </FormField>

      {mode === "admin" && (
        <>
          <FormField label="Team Assignment">
            <Select register={register} name="team">
              <option value="">Agent (No Team)</option>
              {teams.map(t => (
                <option key={t._id} value={t._id}>{t.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="Photo">
            <PhotoInput
              value={watch("imageUrl") || ""}
              onChange={(url) => setValue("imageUrl", url, { shouldValidate: true })}
              disabled={loading}
            />
          </FormField>
        </>
      )}

      <div className="bg-cric-bg p-4 rounded-xl border border-cric-border space-y-3">
        <label className="block text-[9px] font-black uppercase tracking-widest text-cric-text mb-1">
          Categorization
        </label>
        <select {...register("category")} className="w-full p-2 bg-cric-card border border-cric-border rounded-lg text-xs font-bold text-cric-text">
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <Input register={register} name="subCategory" placeholder="Sub-Category (e.g. CS, Eng)" />
        <select {...register("ageGroup")} className="w-full p-2 bg-cric-card border border-cric-border rounded-lg text-xs font-bold text-cric-text">
          {ageGroups.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <Input register={register} name="organization" placeholder="Institution Name" />
      </div>

      <div className="bg-cric-bg p-4 rounded-xl border border-cric-border space-y-2">
        <label className="block text-[9px] font-black uppercase tracking-widest text-cric-muted mb-1">
          Location
        </label>
        <Input register={register} name="address.town" placeholder="Town" />
        <Input register={register} name="address.district" placeholder="District" />
        <Input register={register} name="address.city" placeholder="City" error={errors.address?.city?.message} />
        <Input register={register} name="address.province" placeholder="Province" error={errors.address?.province?.message} />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-4 bg-cric-accent hover:bg-[#e55a2b] text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Submitting..." : buttonText}
      </button>

      {editingId && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-4 bg-cric-bg hover:bg-cric-border text-cric-text font-black text-xs uppercase tracking-widest rounded-xl transition-all"
        >
          Cancel
        </button>
      )}
    </form>
  );
}
