import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from '../models/Admin.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import Match from '../models/Match.js';
import connectDB from '../utils/db.js';

dotenv.config();

async function seed() {
  try {
    await connectDB();

    console.log('🗑️  Clearing existing data...');
    await Admin.deleteMany({});
    await Team.deleteMany({});
    await Player.deleteMany({});
    await Match.deleteMany({});

    // Create default admin
    console.log('👤 Creating default admin...');
    const admin = await Admin.create({
      name: 'Super Admin',
      email: 'admin@bqplay.com',
      password: 'admin123'
    });
    console.log(`✅ Admin created: ${admin.email} / admin123`);

    // Create sample teams
    console.log('🏏 Creating sample teams...');
    const teamA = new Team({ name: 'Abid XI', shortName: 'ABX' });
    const teamB = new Team({ name: 'Tanoli Troopers', shortName: 'TTR' });

    await teamA.save();
    await teamB.save();
    console.log(`✅ Teams created: ${teamA.name}, ${teamB.name}`);

    // Create sample players
    console.log('👥 Creating sample players...');
    const p1 = new Player({ name: 'A. Batsman', role: 'Batsman', team: teamA._id });
    const p2 = new Player({ name: 'T. Bowler', role: 'Bowler', team: teamB._id });

    await p1.save();
    await p2.save();

    teamA.players.push(p1._id);
    teamB.players.push(p2._id);
    await teamA.save();
    await teamB.save();
    console.log(`✅ Players created: ${p1.name}, ${p2.name}`);

    // Create sample match
    console.log('🏆 Creating sample match...');
    const match = new Match({
      title: 'Abid XI vs Tanoli Troopers',
      venue: 'National Ground',
      startAt: new Date(Date.now() + 3600 * 1000),
      teams: [teamA._id, teamB._id],
      innings: [
        { team: teamA._id },
        { team: teamB._id }
      ],
      status: 'upcoming'
    });

    await match.save({ validateModifiedOnly: true });
    console.log(`✅ Match created: ${match.title}`);

    console.log('\n🎉 Seed completed successfully!');
    console.log('\n📋 Default Admin Credentials:');
    console.log('   Email: admin@bqplay.com');
    console.log('   Password: admin123');
    console.log('\n⚠️  IMPORTANT: Change the default password after first login!');

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
}

seed();
