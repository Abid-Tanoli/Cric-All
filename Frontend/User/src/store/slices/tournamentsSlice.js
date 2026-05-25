import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../../services/api";

const initialState = {
  list: [],
  status: "idle",
  error: null,
};

export const fetchTournaments = createAsyncThunk(
  "tournaments/fetchAll",
  async (_, { rejectWithValue }) => {
    try {
      const res = await api.get("/events");
      const data = Array.isArray(res.data) ? res.data : (res.data?.events || []);
      if (data.length === 0) {
        const res2 = await api.get("/tournaments");
        return Array.isArray(res2.data) ? res2.data : (res2.data?.tournaments || []);
      }
      return data;
    } catch (err) {
      try {
        const res = await api.get("/tournaments");
        return Array.isArray(res.data) ? res.data : (res.data?.tournaments || []);
      } catch (err2) {
        return rejectWithValue(err2.response?.data?.message || "Failed to fetch tournaments");
      }
    }
  }
);

const tournamentsSlice = createSlice({
  name: "tournaments",
  initialState,
  reducers: {
    clearTournamentsError(state) { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTournaments.pending, (state) => { state.status = "loading"; state.error = null; })
      .addCase(fetchTournaments.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.list = action.payload;
      })
      .addCase(fetchTournaments.rejected, (state, action) => { state.status = "failed"; state.error = action.payload; });
  },
});

export const { clearTournamentsError } = tournamentsSlice.actions;
export default tournamentsSlice.reducer;
