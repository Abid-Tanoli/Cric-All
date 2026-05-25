import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../../services/api";

const initialState = {
  list: [],
  status: "idle",
  error: null,
};

export const fetchPlayers = createAsyncThunk(
  "players/fetchAll",
  async (params = {}, { rejectWithValue }) => {
    try {
      const { page = 1, limit = 50, search = "", team = "" } = params;
      let url = `/players?page=${page}&limit=${limit}&search=${search}`;
      if (team) url += `&team=${team}`;
      const res = await api.get(url);
      return res.data?.players || res.data || [];
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch players");
    }
  }
);

export const fetchPlayerById = createAsyncThunk(
  "players/fetchById",
  async (id, { rejectWithValue }) => {
    try {
      const res = await api.get(`/players/${id}`);
      return res.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch player");
    }
  }
);

const playersSlice = createSlice({
  name: "players",
  initialState,
  reducers: {
    clearPlayersError(state) { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPlayers.pending, (state) => { state.status = "loading"; state.error = null; })
      .addCase(fetchPlayers.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.list = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(fetchPlayers.rejected, (state, action) => { state.status = "failed"; state.error = action.payload; })
      .addCase(fetchPlayerById.fulfilled, (state, action) => { state.status = "succeeded"; });
  },
});

export const { clearPlayersError } = playersSlice.actions;
export default playersSlice.reducer;
