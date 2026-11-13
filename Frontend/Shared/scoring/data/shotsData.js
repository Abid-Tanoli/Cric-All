export const SHOT_CATEGORIES = {
  front_foot: { label: 'Front-Foot Shots', color: '#3b82f6', desc: 'Vertical-bat front foot shots' },
  back_foot: { label: 'Back-Foot Shots', color: '#8b5cf6', desc: 'Horizontal-bat back foot shots' },
  leg_side: { label: 'Leg-Side Shots', color: '#22c55e', desc: 'Leg-side attacking shots' },
  unorthodox: { label: 'Unorthodox / Modern', color: '#f59e0b', desc: 'Modern T20 innovation strokes' },
  power: { label: 'Power / Lofted Shots', color: '#ef4444', desc: 'Powerful lofted shots' },
  defensive: { label: 'Defensive / Others', color: '#6b7280', desc: 'Block, leave, miss, edge' },
};

const angleRad = (deg) => (deg - 90) * (Math.PI / 180);

export function renderShotSvg(angle, zone, color, label, distance = 75) {
  const cx = 60, cy = 85;
  const rad = angleRad(angle);
  const endX = cx + distance * Math.cos(rad);
  const endY = cy + distance * Math.sin(rad);

  const midDist = distance * 0.55;
  const wedgeWidth = 12;
  const perpAngle = rad + Math.PI / 2;
  const mx = cx + midDist * Math.cos(rad);
  const my = cy + midDist * Math.sin(rad);
  const p1x = mx + wedgeWidth * Math.cos(perpAngle);
  const p1y = my + wedgeWidth * Math.sin(perpAngle);
  const p2x = mx - wedgeWidth * Math.cos(perpAngle);
  const p2y = my - wedgeWidth * Math.sin(perpAngle);

  return { endX, endY, wedgePoints: `${p1x},${p1y} ${endX},${endY} ${p2x},${p2y}` };
}

export const SHOTS = [
  // Front-Foot Shots
  { id: 'straight_drive', name: 'Straight Drive', category: 'front_foot', angle: 0, zone: 'straight',
    desc: 'Bat swings straight down the line. Ball travels past the bowler toward long-on/off.' },
  { id: 'cover_drive', name: 'Cover Drive', category: 'front_foot', angle: 310, zone: 'cover',
    desc: 'Bat swings through the line. Ball races through the cover region. The classic elegant shot.' },
  { id: 'off_drive', name: 'Off Drive', category: 'front_foot', angle: 330, zone: 'mid_off',
    desc: 'Similar to cover drive but aimed straighter between mid-off and extra cover.' },
  { id: 'on_drive', name: 'On Drive', category: 'front_foot', angle: 30, zone: 'mid_on',
    desc: 'Front foot drive through the leg side, aimed between mid-on and mid-wicket.' },
  { id: 'square_drive', name: 'Square Drive', category: 'front_foot', angle: 270, zone: 'point',
    desc: 'Played square of the wicket on the off side, driving through the point region.' },
  { id: 'front_foot_defence', name: 'Front Foot Defence', category: 'front_foot', angle: 0, zone: 'straight',
    desc: 'Defensive shot played on the front foot, blocking the ball.' },

  // Back-Foot Shots
  { id: 'square_cut', name: 'Square Cut', category: 'back_foot', angle: 260, zone: 'point',
    desc: 'Back foot shot played square of the wicket on the off side. Ball cut hard to point.' },
  { id: 'late_cut', name: 'Late Cut', category: 'back_foot', angle: 230, zone: 'third_man',
    desc: 'Played late with soft hands, guiding the ball behind square on the off side toward third man.' },
  { id: 'back_foot_punch', name: 'Back Foot Punch', category: 'back_foot', angle: 200, zone: 'mid_off',
    desc: 'Back foot punch on the off side, typically played against short balls.' },
  { id: 'pull', name: 'Pull Shot', category: 'back_foot', angle: 50, zone: 'mid_wicket',
    desc: 'Back foot shot against short ball. Ball pulled forcefully to mid-wicket or square leg.' },
  { id: 'hook', name: 'Hook Shot', category: 'back_foot', angle: 80, zone: 'fine_leg',
    desc: 'Attacking shot against a bouncer. Ball hooked behind square leg. Riskier than the pull.' },
  { id: 'back_foot_defence', name: 'Back Foot Defence', category: 'back_foot', angle: 0, zone: 'straight',
    desc: 'Defensive shot played on the back foot, blocking the ball.' },

  // Leg-Side Shots
  { id: 'flick', name: 'Flick Shot', category: 'leg_side', angle: 100, zone: 'fine_leg',
    desc: 'Wristy flick off the pads. Ball glances fine down the leg side. Uses the bowler\'s pace.' },
  { id: 'leg_glance', name: 'Leg Glance', category: 'leg_side', angle: 110, zone: 'fine_leg',
    desc: 'Subtle glance off the pads, typically played on the leg side.' },
  { id: 'sweep', name: 'Sweep Shot', category: 'leg_side', angle: 65, zone: 'square_leg',
    desc: 'Kneeling down, bat sweeps across to hit the ball on the leg side behind square.' },
  { id: 'paddle_sweep', name: 'Paddle Sweep', category: 'leg_side', angle: 70, zone: 'square_leg',
    desc: 'Kneeling down with paddle-like grip, sweeping the ball on the leg side.' },
  { id: 'slog_sweep', name: 'Slog Sweep', category: 'leg_side', angle: 60, zone: 'square_leg',
    desc: 'Aggressive slog sweep, typically played on the leg side for big runs.' },

  // Unorthodox / Modern Shots
  { id: 'reverse_sweep', name: 'Reverse Sweep', category: 'unorthodox', angle: 295, zone: 'backward_point',
    desc: 'Kneeling down but reversing the bat to sweep the ball to the off side behind point.' },
  { id: 'switch_hit', name: 'Switch Hit', category: 'unorthodox', angle: 330, zone: 'off_side',
    desc: 'Batsman switches stance (righty to lefty or vice versa) just before the ball is bowled.' },
  { id: 'scoop', name: 'Scoop Shot', category: 'unorthodox', angle: 120, zone: 'fine_leg',
    desc: 'Kneeling or staying low, guiding the ball over the wicketkeeper\'s head to fine leg.' },
  { id: 'ramp', name: 'Ramp Shot', category: 'unorthodox', angle: 115, zone: 'fine_leg',
    desc: 'Playing a ramp shot, guiding the ball over the wicketkeeper\'s head.' },
  { id: 'upper_cut', name: 'Upper Cut', category: 'unorthodox', angle: 125, zone: 'point',
    desc: 'Upper cut shot, hitting the ball above eye level.' },
  { id: 'helicopter', name: 'Helicopter Shot', category: 'unorthodox', angle: 0, zone: 'straight',
    desc: 'MS Dhoni\'s signature. Wrists flick the bat in a helicopter motion, sending ball over long-on.' },
  { id: 'dil_scoop', name: 'Dil Scoop', category: 'unorthodox', angle: 130, zone: 'fine_leg',
    desc: 'Dil scoop shot, scooping the ball over the wicketkeeper\'s head.' },

  // Power / Lofted Shots
  { id: 'lofted_drive', name: 'Lofted Drive', category: 'power', angle: 45, zone: 'long_on',
    desc: 'Powerful lofted drive, typically aimed for sixes.' },
  { id: 'inside_out', name: 'Inside Out Shot', category: 'power', angle: 320, zone: 'cover',
    desc: 'Inside-out shot, playing the ball from the leg side to the off side.' },
  { id: 'slog', name: 'Slog', category: 'power', angle: 40, zone: 'long_on',
    desc: 'Big wild swing aiming for six. Usually over mid-wicket or long-on.' },
  { id: 'chip_shot', name: 'Chip Shot', category: 'power', angle: 90, zone: 'mid_wicket',
    desc: 'Chip shot, hitting the ball in the air with a chip motion.' },

  // Original shots (kept for backward compatibility)
  { id: 'flick_glance', name: 'Flick / Glance', category: 'leg_side', angle: 100, zone: 'fine_leg',
    desc: 'Wristy flick off the pads. Ball glances fine down the leg side. Uses the bowler\'s pace.' },
  { id: 'scoop_ramp', name: 'Scoop / Ramp', category: 'unorthodox', angle: 120, zone: 'fine_leg',
    desc: 'Kneeling or staying low, guiding the ball over the wicketkeeper\'s head to fine leg.' },
  { id: 'lofted_slog', name: 'Lofted / Slog', category: 'power', angle: 35, zone: 'long_on',
    desc: 'Big wild swing aiming for six. Usually over mid-wicket or long-on.' },
  { id: 'defended', name: 'Defended', category: 'defensive', angle: 0, zone: 'straight',
    desc: 'Bat angled downward, dead-batting the ball back to the bowler. No intent to score.' },
  { id: 'left_padded', name: 'Left / Padded Away', category: 'defensive', angle: null, zone: null,
    desc: 'Deliberately leaving the ball or padding it away. No shot offered.' },
  { id: 'missed_beaten', name: 'Missed / Beaten', category: 'defensive', angle: null, zone: null,
    desc: 'Ball beats the bat. Batsman either missed the line or the ball moved past the edge.' },
  { id: 'edged', name: 'Edged', category: 'defensive', angle: 270, zone: 'slips',
    desc: 'Ball takes the outside edge of the bat, typically flying toward the slip cordon.' },
  { id: 'no_shot', name: 'No Shot Offered', category: 'defensive', angle: null, zone: null,
    desc: 'Batsman offered no stroke. Usually leaving the ball outside off or taking it on the body.' },
];
