import xlsx from 'xlsx';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import * as playerService from '../services/playerService.js';
import { getIO } from '../socket/socket.js';

export const bulkImportPlayers = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    const players = [];
    const errors = [];
    const duplicates = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      try {
        // Validate required fields
        if (!row.Name) {
          errors.push({ row: i + 2, error: 'Name is required' });
          continue;
        }

        const phone = row.Phone || row.phone || '';
        const playerData = {
          name: row.Name,
          role: row.Role || '',
          Campus: row.Campus || '',
          imageUrl: row.ImageUrl || row.Image || '',
        };

        // Handle team assignment
        if (row.Team) {
          const teamName = row.Team;
          let team = await Team.findOne({ name: new RegExp(`^${teamName}$`, 'i') });

          if (team) {
            playerData.team = team._id;
          } else {
            errors.push({
              row: i + 2,
              error: `Team "${teamName}" not found`
            });
          }
        }

        // Terminal A: backend-enforced duplicate prevention. A row that repeats
        // an existing player (same name in the same team, or the same phone
        // anywhere) is skipped and reported, never inserted twice.
        try {
          await playerService.assertPlayerNotDuplicate({
            name: playerData.name,
            team: playerData.team,
            phone,
          });
        } catch (dupErr) {
          if (dupErr.code === 'PLAYER_DUPLICATE') {
            duplicates.push({ row: i + 2, error: dupErr.message });
            continue;
          }
          throw dupErr;
        }

        const canonicalPhone = playerService.canonicalPlayerPhone(phone);
        if (canonicalPhone) playerData.phone = canonicalPhone;
        const jersey = row.JerseyNumber ?? row.jersey_no ?? row.Jersey;
        if (jersey !== undefined && jersey !== '') playerData.jerseyNumber = Number(jersey);

        const player = await Player.create(playerData);

        // Add player to team if team exists
        if (playerData.team) {
          await Team.findByIdAndUpdate(
            playerData.team,
            { $addToSet: { players: player._id } }
          );
        }

        players.push(player);
      } catch (error) {
        errors.push({
          row: i + 2,
          error: error.message
        });
      }
    }

    try {
      const io = getIO();
      io.emit('players:bulk-imported', { count: players.length });
    } catch (socketError) {
      console.log('Socket not available:', socketError.message);
    }

    res.status(201).json({
      message: `${players.length} players imported successfully`,
      imported: players.length,
      duplicates: duplicates.length > 0 ? duplicates : undefined,
      errors: errors.length > 0 ? errors : undefined,
      players
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({
      message: 'Failed to import players',
      error: error.message
    });
  }
};

export const bulkImportTeams = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    const teams = [];
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      try {
        if (!row.Name) {
          errors.push({ row: i + 2, error: 'Team name is required' });
          continue;
        }

        // Check if team already exists
        const existingTeam = await Team.findOne({
          name: new RegExp(`^${row.Name}$`, 'i')
        });

        if (existingTeam) {
          errors.push({
            row: i + 2,
            error: `Team "${row.Name}" already exists`
          });
          continue;
        }

        const teamData = {
          name: row.Name,
          shortName: row.ShortName || row.Name.substring(0, 3).toUpperCase(),
          ownername: row.Owner || row.OwnerName || '',
          logo: row.Logo || ''
        };

        const team = await Team.create(teamData);
        teams.push(team);
      } catch (error) {
        errors.push({
          row: i + 2,
          error: error.message
        });
      }
    }

    try {
      const io = getIO();
      io.emit('teams:bulk-imported', { count: teams.length });
    } catch (socketError) {
      console.log('Socket not available:', socketError.message);
    }

    res.status(201).json({
      message: `${teams.length} teams imported successfully`,
      imported: teams.length,
      errors: errors.length > 0 ? errors : undefined,
      teams
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({
      message: 'Failed to import teams',
      error: error.message
    });
  }
};

export const downloadPlayerTemplate = (req, res) => {
  const wb = xlsx.utils.book_new();
  const ws_data = [
    ['Name', 'Role', 'Campus', 'Team', 'ImageUrl'],
    ['John Doe', 'Batsman', 'Campus A', 'Team Eagles', 'https://example.com/player1.png'],
    ['Jane Smith', 'Bowler', 'Campus B', 'Team Lions', 'https://example.com/player2.png'],
    ['Mike Johnson', 'All-rounder', 'Campus C', 'Team Tigers', 'https://example.com/player3.png']
  ];
  const ws = xlsx.utils.aoa_to_sheet(ws_data);
  xlsx.utils.book_append_sheet(wb, ws, 'Players');

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename=player_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
};

export const downloadTeamTemplate = (req, res) => {
  const wb = xlsx.utils.book_new();
  const ws_data = [
    ['Name', 'ShortName', 'Owner', 'Logo'],
    ['Team Eagles', 'EAG', 'John Doe', 'https://example.com/logo1.png'],
    ['Team Lions', 'LIO', 'Jane Smith', 'https://example.com/logo2.png'],
    ['Team Tigers', 'TIG', 'Mike Johnson', 'https://example.com/logo3.png']
  ];
  const ws = xlsx.utils.aoa_to_sheet(ws_data);
  xlsx.utils.book_append_sheet(wb, ws, 'Teams');

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename=team_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
};