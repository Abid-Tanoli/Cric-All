import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../../services/api";

// Async thunk to fetch matches
export const fetchMatches = createAsyncThunk(
  "matches/fetchMatches",
  async (_, { rejectWithValue }) => {
    try {
      const res = await api.get("/matches");
      const data = res.data?.matches || res.data;
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

const matchesSlice = createSlice({
  name: "matches",
  initialState: {
    list: [],      // default empty array
    status: "idle",
    error: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMatches.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchMatches.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.list = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(fetchMatches.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Failed to fetch matches";
        state.list = [];
      });
  },
});

export default matchesSlice.reducer;
