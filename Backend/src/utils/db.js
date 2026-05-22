import mongoose from "mongoose";

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error("Mongo URL not found! Check your .env");
    }

    const connect = await mongoose.connect(process.env.MONGO_URL);

    console.log(`✅ MongoDB Connected: ${connect.connection.host}`);
  } catch (err) {
    console.error("❌ MongoDB Error:", err.message);
    process.exit(1);
  }
};

export default connectDB;
