
import mongoose from 'mongoose';
import Match from './src/models/Match.js';
import dotenv from 'dotenv';
dotenv.config();

const mongoUrl = "mongodb+srv://visionaryabidi_db_user:tanoli1369@bq-play.71f7rbu.mongodb.net/";
const matchId = "69e8ab621b5b799570852ab9";

async function resetMatch() {
    await mongoose.connect(mongoUrl);
    const match = await Match.findById(matchId);
    if (!match) {
        console.log("Match not found");
        process.exit(1);
    }

    const inn = match.innings[match.currentInnings];
    inn.runs = 0;
    inn.wickets = 0;
    inn.balls = 0;
    inn.overs = 0;
    inn.extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 };
    inn.batting = [];
    inn.bowling = [];
    inn.oversHistory = [];
    inn.fallOfWickets = [];
    inn.partnerships = [];
    
    // Also reset openers if needed, but we'll leave current ids
    // Set them to 0 if they exist in batting later
    
    await match.save();
    console.log("Match reset successfully");
    process.exit(0);
}

resetMatch();
