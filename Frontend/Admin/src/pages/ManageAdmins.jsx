import React, { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { api } from "../services/api";
import { useToast } from "../components/Toast";

const initialForm = { name: "", email: "", password: "" };

export default function ManageAdmins() {
  const currentUser = useSelector((state) => state.auth.user);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const { showToast } = useToast();

  const isSuperAdmin = currentUser?.role === "superadmin";

  const fetchAdmins = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/admin");
      setAdmins(data);
    } catch {
      showToast("Failed to load admins", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      showToast("Name, email and password are required", "warning");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/admin/create", form);
      showToast("Admin created successfully", "success");
      setForm(initialForm);
      fetchAdmins();
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to create admin", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveAdmin = async (id, name) => {
    if (!window.confirm(`Remove admin "${name}"? This cannot be undone.`)) return;
    setRemovingId(id);
    try {
      await api.delete(`/admin/${id}`);
      showToast("Admin removed", "success");
      fetchAdmins();
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to remove admin", "error");
    } finally {
      setRemovingId(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-xl font-black text-[#031d44]">Super Admin Access Required</h1>
          <p className="text-slate-500 mt-2 font-medium">
            Only a super admin can manage admins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      <div className="mb-10">
        <h1 className="text-4xl font-black text-[#031d44] tracking-tight">MANAGE ADMINS</h1>
        <p className="text-slate-500 mt-2 font-medium">
          Super admin only. Create and remove admin accounts.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">

        {/* Admin list */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-800">Admins</h2>
            <button
              onClick={fetchAdmins}
              className="text-xs font-bold text-blue-600 hover:text-blue-800"
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : admins.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">👤</p>
              <p className="text-sm text-slate-400 font-medium">No admins found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-200">
                    <th className="py-3 pr-4 font-bold">Name</th>
                    <th className="py-3 pr-4 font-bold">Email</th>
                    <th className="py-3 pr-4 font-bold">Role</th>
                    <th className="py-3 pr-4 font-bold">Created</th>
                    <th className="py-3 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((admin) => {
                    const isSelf = String(admin._id) === String(currentUser?._id);
                    return (
                      <tr key={admin._id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 pr-4 font-bold text-slate-800">
                          {admin.name}
                          {isSelf && (
                            <span className="ml-2 text-[10px] font-black uppercase text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">
                              You
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-slate-500">{admin.email}</td>
                        <td className="py-3 pr-4">
                          <span
                            className={`text-[10px] font-black uppercase rounded px-2 py-0.5 ${
                              admin.role === "superadmin"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {admin.role}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-slate-500">
                          {admin.createdAt
                            ? new Date(admin.createdAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => handleRemoveAdmin(admin._id, admin.name)}
                            disabled={isSelf || removingId === admin._id}
                            title={isSelf ? "You cannot remove yourself" : "Remove admin"}
                            className="px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          >
                            {removingId === admin._id ? "..." : "Remove"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add Admin form */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit lg:sticky lg:top-6">
          <h2 className="text-lg font-bold text-slate-800 mb-4">Add Admin</h2>
          <form onSubmit={handleAddAdmin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Admin name"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@example.com"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Strong password"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                New admins are always created with the "admin" role.
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? "Creating..." : "Add Admin"}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}