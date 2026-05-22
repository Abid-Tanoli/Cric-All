
import mongoose from 'mongoose';
import Match from './src/models/Match.js';
import dotenv from 'dotenv';
dotenv.config();

const mongoUrl = "mongodb+srv://visionaryabidi_db_user:tanoli1369@bq-play.71f7rbu.mongodb.net/";

async function checkMatch() {
    await mongoose.connect(mongoUrl);
    const matches = await Match.find({ status: 'live' });
    console.log(JSON.stringify(matches, null, 2));
    process.exit(0);
}

checkMatch();
