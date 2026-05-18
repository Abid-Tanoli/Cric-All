// Field Position Mapping Service
// Converts click coordinates (x, y) to cricket fielding zones
// and generates contextual commentary based on position + runs

class FieldPositionMapper {
  constructor() {
    // Field zones defined as regions on a 100x100 grid
    // Origin (0,0) = top-left, (100,100) = bottom-right
    // Batsman faces from bottom to top (50,100 -> 50,0)
    this.fieldZones = [
      { name: 'wicket-keeper', x: 50, y: 28, angle: 180 },
      { name: 'first-slip', x: 43, y: 32, angle: 150 },
      { name: 'second-slip', x: 38, y: 34, angle: 140 },
      { name: 'gully', x: 31, y: 40, angle: 120 },
      { name: 'third-man', x: 23, y: 18, angle: 135 },
      { name: 'deep-third-man', x: 16, y: 27, angle: 135 },
      { name: 'backward-point', x: 22, y: 52, angle: 100 },
      { name: 'point', x: 18, y: 61, angle: 90 },
      { name: 'deep-point', x: 8, y: 61, angle: 90 },
      { name: 'cover-point', x: 28, y: 70, angle: 65 },
      { name: 'cover', x: 32, y: 79, angle: 55 },
      { name: 'deep-cover', x: 15, y: 80, angle: 55 },
      { name: 'extra-cover', x: 38, y: 84, angle: 35 },
      { name: 'deep-extra-cover', x: 23, y: 91, angle: 35 },
      { name: 'mid-off', x: 44, y: 76, angle: 18 },
      { name: 'long-off', x: 37, y: 96, angle: 18 },
      { name: 'straight', x: 50, y: 97, angle: 0 },
      { name: 'bowler', x: 50, y: 73, angle: 0 },
      { name: 'mid-on', x: 56, y: 76, angle: -18 },
      { name: 'long-on', x: 63, y: 96, angle: -18 },
      { name: 'mid-wicket', x: 70, y: 79, angle: -55 },
      { name: 'deep-mid-wicket', x: 86, y: 80, angle: -55 },
      { name: 'square-leg', x: 82, y: 61, angle: -90 },
      { name: 'deep-square-leg', x: 92, y: 61, angle: -90 },
      { name: 'backward-square-leg', x: 78, y: 52, angle: -105 },
      { name: 'fine-leg', x: 72, y: 34, angle: -135 },
      { name: 'deep-fine-leg', x: 84, y: 27, angle: -135 },
      { name: 'long-leg', x: 77, y: 18, angle: -150 },
      { name: 'short-fine-leg', x: 63, y: 40, angle: -125 }
    ];

    // Distance zones
    this.distanceZones = {
      infield: { maxDist: 40 },    // 0-40% from batsman
      ring: { minDist: 40, maxDist: 65 },  // 40-65%
      deep: { minDist: 65 }        // 65%+
    };
  }

  // Convert click coordinates (x, y on 100x100 grid) to fielding zone
  getZoneFromCoordinates(x, y) {
    // Normalize coordinates
    const normX = Math.max(0, Math.min(100, x));
    const normY = Math.max(0, Math.min(100, y));

    // Find matching rectangular zone when legacy bounds exist.
    for (const zone of this.fieldZones) {
      if (zone.x != null && zone.y != null) continue;
      if (normX >= zone.xMin && normX <= zone.xMax && normY >= zone.yMin && normY <= zone.yMax) {
        return {
          name: zone.name,
          angle: zone.angle,
          distance: this.calculateDistanceFromCenter(normX, normY),
          x: normX,
          y: normY
        };
      }
    }

    // Default: find closest zone
    return this.findClosestZone(normX, normY);
  }

  // Calculate distance from batsman position (center-bottom: 50, 85)
  calculateDistanceFromCenter(x, y) {
    const batsmanX = 50;
    const batsmanY = 85;
    const dx = x - batsmanX;
    const dy = y - batsmanY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Find closest fielding zone
  findClosestZone(x, y) {
    let closestZone = null;
    let minDistance = Infinity;

    for (const zone of this.fieldZones) {
      const centerX = zone.x ?? (zone.xMin + zone.xMax) / 2;
      const centerY = zone.y ?? (zone.yMin + zone.yMax) / 2;
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

      if (distance < minDistance) {
        minDistance = distance;
        closestZone = zone;
      }
    }

    return {
      name: closestZone.name,
      angle: closestZone.angle,
      distance: this.calculateDistanceFromCenter(x, y),
      x,
      y
    };
  }

  // Get distance category (infield, ring, deep)
  getDistanceCategory(distance) {
    if (distance <= this.distanceZones.infield.maxDist) return 'infield';
    if (distance <= this.distanceZones.ring.maxDist) return 'ring';
    return 'deep';
  }

  // Generate shot description based on zone and runs
  generateShotDescription(zone, runs, isWicket = false) {
    const distanceCat = this.getDistanceCategory(zone.distance);
    const zoneName = zone.name.toLowerCase();

    if (isWicket) {
      return this.generateWicketDescription(zoneName, distanceCat);
    }

    // Shot type based on zone
    const shotTypes = {
      'cover': 'drive through covers',
      'extra-cover': 'drive through extra cover',
      'deep-cover': 'lofted drive over cover',
      'point': 'cut past point',
      'backward-point': 'late cut past backward point',
      'deep-point': 'cut over backward point',
      'mid-wicket': 'flick through mid wicket',
      'deep-mid-wicket': 'pull over mid wicket',
      'square-leg': 'glance past square leg',
      'deep-square-leg': 'pull over square leg',
      'third-man': 'guided past third man',
      'fine-leg': 'glance past fine leg',
      'deep-fine-leg': 'scoop over fine leg',
      'long-on': 'lofted over long on',
      'long-off': 'lofted over long off',
      'mid-off': 'driven to mid off',
      'mid-on': 'worked to mid on',
      'bowler': 'straight back to bowler',
      'first-slip': 'edge to slip',
      'second-slip': 'edge to slip',
      'gully': 'edge to gully',
    };

    const shotType = shotTypes[zoneName] || `shot to ${zoneName}`;

    if (runs === 0) {
      return `dot ball - ${shotType}, no run`;
    } else if (runs === 1) {
      return `single - ${shotType}`;
    } else if (runs === 2) {
      return `two runs - ${shotType}, good running`;
    } else if (runs === 3) {
      return `three runs - ${shotType}, excellent running`;
    } else if (runs === 4) {
      if (distanceCat === 'deep') {
        return `FOUR! ${shotType.replace(/to|past|over/g, 'and over')} for a boundary!`;
      }
      return `FOUR! Beautiful ${shotType}, races away to the fence!`;
    } else if (runs === 6) {
      return `SIX! MASSIVE! ${shotType.replace(/to|past/g, 'and over')} for a maximum!`;
    }

    return `${runs} runs - ${shotType}`;
  }

  // Generate wicket description
  generateWicketDescription(zoneName, distanceCat) {
    const wicketDescriptions = {
      'first-slip': 'edged and taken at first slip!',
      'second-slip': 'thick edge flies to second slip, caught!',
      'gully': 'edged to gully, sharp catch!',
      'cover': 'drives straight to cover, caught!',
      'mid-wicket': 'pulls it straight to mid wicket, caught!',
      'mid-on': 'skies it to mid on, simple catch!',
      'mid-off': 'lobs to mid off, caught!',
      'long-on': 'holed out to long on!',
      'long-off': 'holes out to long off!',
      'deep-mid-wicket': 'deep mid wicket takes it on the boundary!',
      'deep-square-leg': 'caught at deep square leg!',
      'bowler': 'straight back to the bowler, caught!',
    };

    return wicketDescriptions[zoneName] || `caught at ${zoneName}!`;
  }

  // Generate full commentary based on field position
  generateFieldCommentary(bowlerName, batsmanName, runs, zone, isWicket = false, wicketType = '') {
    const shotDesc = this.generateShotDescription(zone, runs, isWicket);
    const distanceCat = this.getDistanceCategory(zone.distance);

    if (isWicket) {
      return `WICKET! ${batsmanName} ${shotDesc} ${bowlerName} strikes!`;
    }

    // Add distance context
    let context = '';
    if (distanceCat === 'infield') {
      context = 'fielder quickly collects';
    } else if (distanceCat === 'ring') {
      context = 'fielder chases it down';
    } else {
      context = 'no fielder in range';
    }

    return `${shotDesc} ${context}`;
  }
}

export default new FieldPositionMapper();
