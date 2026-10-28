// The option lists behind the player forms.
//
// They duplicate the enums in Backend/src/models/Player.js (and the
// PLAYING_ROLES/BATTING_STYLES/… exports in Backend/src/validators/playerValidators.js)
// because the frontend cannot import a Mongoose model. Before this file the same
// four lists existed in three components, two of them already out of date — a
// form that offers "Left-arm Chinaman" nowhere but the database accepts it is a
// silent data-entry gap, and one that offers a spelling the server rejects is a
// 400 the user cannot act on.
//
// `battingPosition` is different: its values/labels live in one shared module
// consumed by both frontends, so it is re-exported here rather than copied a
// second time.
import {
  BATTING_POSITION_LABELS,
  BATTING_POSITION_OPTIONS,
  BATTING_POSITION_VALUES,
  battingPositionLabel,
} from "@shared/battingPositions";

export {
  BATTING_POSITION_LABELS,
  BATTING_POSITION_OPTIONS,
  BATTING_POSITION_VALUES,
  battingPositionLabel,
};

export const PLAYING_ROLES = [
  "Batsman",
  "Bowler",
  "All-Rounder",
  "Batting-All-Rounder",
  "Bowling-All-Rounder",
  "Wicket-Keeper",
];

export const BATTING_STYLES = ["Right-handed", "Left-handed"];

export const BOWLING_STYLES = [
  "Right-arm Fast",
  "Right-arm Fast-Medium",
  "Right-arm Medium",
  "Right-arm Medium-Pace",
  "Right-arm Off-break",
  "Right-arm Leg-break",
  "Right-arm Slow",
  "Left-arm Fast",
  "Left-arm Fast-Medium",
  "Left-arm Medium",
  "Left-arm Medium-Pace",
  "Left-arm Orthodox",
  "Left-arm Chinaman",
  "Left-arm Slow",
  "Not Applicable",
];

export const PLAYER_CATEGORIES = [
  "School",
  "College",
  "University",
  "Organization",
  "Business",
  "Industry",
  "Club",
  "International",
  "Other",
];

export const AGE_GROUPS = ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"];

export default {
  PLAYING_ROLES,
  BATTING_STYLES,
  BOWLING_STYLES,
  PLAYER_CATEGORIES,
  AGE_GROUPS,
  BATTING_POSITION_OPTIONS,
  BATTING_POSITION_VALUES,
  BATTING_POSITION_LABELS,
  battingPositionLabel,
};
