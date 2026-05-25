import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../../services/api";

const initialState = {
  list: [],
  status: "idle",
  error: null,
};

export const fetchTeams = createAsyncThunk(
  "teams/fetchAll",
  async (_, { rejectWithValue }) => {
    try {
      const res = await api.get("/teams");
      const data = res.data?.teams || res.data;
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch teams");
    }
  }
);

export const fetchTeamById = createAsyncThunk(
  "teams/fetchById",
  async (id, { rejectWithValue }) => {
    try {
      const res = await api.get(`/teams/${id}`);
      return res.data?.data || res.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "Failed to fetch team");
    }
  }
);

const teamsSlice = createSlice({
  name: "teams",
  initialState,
  reducers: {
    clearTeamsError(state) { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTeams.pending, (state) => { state.status = "loading"; state.error = null; })
      .addCase(fetchTeams.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.list = action.payload;
      })
      .addCase(fetchTeams.rejected, (state, action) => { state.status = "failed"; state.error = action.payload; })
      .addCase(fetchTeamById.fulfilled, (state) => { state.status = "succeeded"; });
  },
});

export const { clearTeamsError } = teamsSlice.actions;
export default teamsSlice.reducer;
