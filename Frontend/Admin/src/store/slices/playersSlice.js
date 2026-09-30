import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../services/api";

const initialState = {
  players: [],
  pagination: {
    totalPlayers: 0,
    totalPages: 0,
    currentPage: 1,
  },
  loading: false,
  error: null,
};

export const fetchPlayers = createAsyncThunk(
  "players/fetchAll",
  async (params = {}, thunkAPI) => {
    try {
      const { page = 1, limit = 10, search = "", team = "", Campus = "" } = params;
      let url = `/players?page=${page}&limit=${limit}`;
      if (team) url += `&team=${team}`;
      // The query param is `campus`; it was being sent as `Campus`, which the
      // backend never read, so the campus filter silently did nothing.
      if (Campus) url += `&campus=${encodeURIComponent(Campus)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const res = await api.get(url);
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to fetch players"
      );
    }
  }
);

export const createPlayer = createAsyncThunk(
  "players/create",
  async (data, thunkAPI) => {
    try {
      const res = await api.post("/players", data);
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to create player"
      );
    }
  }
);

export const updatePlayer = createAsyncThunk(
  "players/update",
  async ({ id, data }, thunkAPI) => {
    try {
      const res = await api.put(`/players/${id}`, data);
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to update player"
      );
    }
  }
);

export const updatePlayerStats = createAsyncThunk(
  "players/updateStats",
  async ({ id, stats }, thunkAPI) => {
    try {
      const res = await api.put(`/players/${id}`, { stats });
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to update stats"
      );
    }
  }
);

export const deletePlayer = createAsyncThunk(
  "players/delete",
  async (id, thunkAPI) => {
    try {
      await api.delete(`/players/${id}`);
      return id;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to delete player"
      );
    }
  }
);

export const bulkDeletePlayers = createAsyncThunk(
  "players/bulkDelete",
  async (playerIds, thunkAPI) => {
    try {
      const res = await api.post("/players/bulk-delete", { playerIds });
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to bulk delete players"
      );
    }
  }
);

export const fetchPlayerRankings = createAsyncThunk(
  "players/rankings",
  async (_, thunkAPI) => {
    try {
      const res = await api.get("/players/rankings");
      return res.data;
    } catch (err) {
      return thunkAPI.rejectWithValue(
        err.response?.data?.message || "Failed to fetch rankings"
      );
    }
  }
);

const playersSlice = createSlice({
  name: "players",
  initialState,
  reducers: {
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch all players
      .addCase(fetchPlayers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPlayers.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload?.players) {
          state.players = action.payload.players;
          state.pagination = {
            totalPlayers: action.payload.totalPlayers,
            totalPages: action.payload.totalPages,
            currentPage: action.payload.currentPage,
          };
        } else {
          state.players = Array.isArray(action.payload) ? action.payload : [];
        }
      })
      .addCase(fetchPlayers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Create player
      .addCase(createPlayer.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createPlayer.fulfilled, (state, action) => {
        state.loading = false;
        const player = action.payload?.player || action.payload;
        if (player) {
          state.players.push(player);
        }
      })
      .addCase(createPlayer.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Update player
      .addCase(updatePlayer.fulfilled, (state, action) => {
        const updated = action.payload?.player || action.payload;
        if (updated) {
          const index = state.players.findIndex((p) => p._id === updated._id);
          if (index !== -1) {
            state.players[index] = updated;
          }
        }
      })
      // Update stats
      .addCase(updatePlayerStats.fulfilled, (state, action) => {
        const updated = action.payload?.player || action.payload;
        if (updated) {
          const index = state.players.findIndex((p) => p._id === updated._id);
          if (index !== -1) {
            state.players[index] = updated;
          }
        }
      })
      // Delete player
      .addCase(deletePlayer.fulfilled, (state, action) => {
        state.players = state.players.filter((p) => p._id !== action.payload);
      })
      // Bulk delete players
      .addCase(bulkDeletePlayers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(bulkDeletePlayers.fulfilled, (state) => {
        state.loading = false;
        state.players = [];
      })
      .addCase(bulkDeletePlayers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearError } = playersSlice.actions;
export default playersSlice.reducer;
