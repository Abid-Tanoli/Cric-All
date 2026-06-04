import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { updateTeam, fetchTeams } from '../store/slices/teamSlice';
import api from '../services/api';
import TeamForm from '../components/admin/teams/TeamForm';
import { useToast } from '../components/Toast';

export default function TeamEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { showToast } = useToast();

  useEffect(() => {
    fetchTeam();
  }, [id]);

  const fetchTeam = async () => {
    try {
      const res = await api.get(`/teams/${id}`);
      const data = res.data.data || res.data;
      setTeam(data.team || data);
    } catch (e) {
      setError('Failed to load team');
      console.error(e);
    }
    setLoading(false);
  };

  const handleSave = async (formData) => {
    setSaving(true);
    try {
      const result = await dispatch(updateTeam({ id, data: formData }));
      if (result.meta.requestStatus === 'fulfilled') {
        dispatch(fetchTeams());
        navigate(`/admin/teams/${id}`);
      } else {
        showToast(result.payload || 'Failed to update team', 'error');
      }
    } catch (e) {
      showToast('Failed to update team', 'error');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#031d44]" />
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 font-bold text-xl mb-4">{error || 'Team not found'}</p>
          <button onClick={() => navigate('/admin/teams')} className="bg-[#031d44] text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3">
            Back to Teams
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      <button
        onClick={() => navigate(`/admin/teams/${id}`)}
        className="text-slate-600 hover:text-[#031d44] font-bold text-sm mb-6 inline-block"
      >
        ← Back to Team
      </button>

      <h1 className="text-3xl lg:text-4xl font-black text-[#031d44] mb-8">
        Edit: {team.name}
      </h1>

      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 lg:p-8">
        <TeamForm
          editMode={true}
          currentTeam={team}
          onSave={handleSave}
          onCancel={() => navigate(`/admin/teams/${id}`)}
        />
      </div>

      {saving && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 shadow-2xl flex items-center gap-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#031d44]" />
            <span className="font-bold text-[#031d44]">Saving...</span>
          </div>
        </div>
      )}
    </div>
  );
}
