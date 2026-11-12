import mongoose from "mongoose";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";

const URI = "mongodb://127.0.0.1:27017/cric-all-e2e";
const ADDITIONS = {
  "Baldia Zalmi": ["Nasir", "Taeem Khan", "Javeed Afridi", "Zahid Khan", "Saud Jin", "Ghufran", "Fazal Bajuri"],
  "Sky Sports": ["Kamran Kamal", "M. Shahnawaz", "Akbar Sadozai", "Usman", "Abdul Rehman", "M. Zarnain"],
};

await mongoose.connect(URI, { serverSelectionTimeoutMS: 10000 });
let created = 0;
for (const [teamName, names] of Object.entries(ADDITIONS)) {
  const team = await Team.findOne({ name: teamName });
  if (!team) throw new Error(`missing team ${teamName}`);
  for (const name of names) {
    const existing = await Player.findOne({ name, team: team._id });
    if (existing) continue;
    const player = await Player.create({ name, team: team._id, isPublic: true });
    team.players = [...(team.players || []), player._id];
    await team.save();
    created += 1;
  }
}
console.log(JSON.stringify({ created }));
await mongoose.disconnect();
