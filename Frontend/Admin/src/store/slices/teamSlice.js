import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../services/api";

const initialState = {
  teams: [],
  loading: false,
  error: null,
};

export const fetchTeams = createAsyncThunk(
  "teams/fetchAll",
  async (_, thunkAPI) => {
    try {
      const res = await api.get("/teams");
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to fetch teams"
      );
    }
  }
);

export const createTeam = createAsyncThunk(
  "teams/create",
  async (data, thunkAPI) => {
    try {
      const res = await api.post("/teams", data);
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to create team"
      );
    }
  }
);

export const updateTeam = createAsyncThunk(
  "teams/update",
  async ({ id, data }, thunkAPI) => {
    try {
      const res = await api.put(`/teams/${id}`, data);
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to update team"
      );
    }
  }
);

export const deleteTeam = createAsyncThunk(
  "teams/delete",
  async (id, thunkAPI) => {
    try {
      await api.delete(`/teams/${id}`);
      return id;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to delete team"
      );
    }
  }
);

export const addPlayersToTeam = createAsyncThunk(
  "teams/addPlayers",
  async ({ teamId, playerIds }, thunkAPI) => {
    try {
      const res = await api.post(`/teams/${teamId}/players`, { playerIds });
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to add players"
      );
    }
  }
);

export const removePlayersFromTeam = createAsyncThunk(
  "teams/removePlayers",
  async ({ id, playerIds }, thunkAPI) => {
    try {
      const res = await api.delete(`/teams/${id}/players`, {
        data: { playerIds },
      });
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to remove players"
      );
    }
  }
);

const teamsSlice = createSlice({
  name: "teams",
  initialState,
  reducers: {
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTeams.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTeams.fulfilled, (state, action) => {
        state.loading = false;
        state.teams = Array.isArray(action.payload)
          ? action.payload
          : action.payload?.teams || [];
      })
      .addCase(fetchTeams.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createTeam.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createTeam.fulfilled, (state, action) => {
        state.loading = false;
        const team = action.payload?.team || action.payload;
        if (team) {
          state.teams.push(team);
        }
      })
      .addCase(createTeam.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(updateTeam.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateTeam.fulfilled, (state, action) => {
        state.loading = false;
        const updated = action.payload?.team || action.payload;
        if (updated) {
          const index = state.teams.findIndex((t) => t._id === updated._id);
          if (index !== -1) {
            state.teams[index] = updated;
          }
        }
      })
      .addCase(updateTeam.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(deleteTeam.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteTeam.fulfilled, (state, action) => {
        state.loading = false;
        state.teams = state.teams.filter((t) => t._id !== action.payload);
      })
      .addCase(deleteTeam.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(addPlayersToTeam.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addPlayersToTeam.fulfilled, (state, action) => {
        state.loading = false;
        const updated = action.payload?.team || action.payload;
        if (updated) {
          const index = state.teams.findIndex((t) => t._id === updated._id);
          if (index !== -1) {
            state.teams[index] = updated;
          }
        }
      })
      .addCase(addPlayersToTeam.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(removePlayersFromTeam.fulfilled, (state, action) => {
        const updated = action.payload?.team || action.payload;
        if (updated) {
          const index = state.teams.findIndex((t) => t._id === updated._id);
          if (index !== -1) {
            state.teams[index] = updated;
          }
        }
      });
  },
});

export const { clearError } = teamsSlice.actions;
export default teamsSlice.reducer;
